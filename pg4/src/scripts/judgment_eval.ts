import fs from 'fs';
import { parseArgs, reqString, hasHelp } from '../cli/_args';
import type { Lead } from '../types/lead';
import { runJudgment } from '../judgment/run_judgment';
import { getActiveJudgmentConfig } from '../judgment/config';
import { evaluate, type GoldenItem } from '../judgment/eval';
import { liveFreeHarvestContext, buildJudgeLLM } from '../judgment/runtime_context';
import { InMemoryEnrichmentCache } from '../persistence/enrichment_cache';
import { emptyBundle } from '../judgment/harvest/source_harvest';
import type { JudgmentRecord } from '../types/judgment';

/**
 * §15 golden-set eval runner.
 * `pnpm run judge:eval -- --golden tests/fixtures/judgment_golden.json [--paid]`
 *
 * The golden file is the GROUND TRUTH the team hand-labels (the protocol/rubric
 * is the operator's deliverable). This runner only EXECUTES the pipeline on it
 * and prints the metrics: precision/recall on the target verdict + SEPARATE
 * agreement on A and on B (so you see WHICH judge errs) + the quadrant confusion
 * matrix. It is the metro that turns "the machine runs" into "the judgment is valid".
 *
 * File shape: { "items": [ { "id", "lead": {...}, "expectedTarget",
 *   "expectedQuadrant"?, "expectedALevel"?, "expectedBLevel"?, "expectedModel"? } ] }
 */
interface GoldenFileItem extends GoldenItem {
  lead: Lead;
}

async function main(): Promise<number> {
  const args = parseArgs();
  if (hasHelp(args)) {
    process.stdout.write('usage: pnpm run judge:eval -- --golden <golden.json> [--paid]\n');
    return 0;
  }
  const goldenPath = reqString(args, 'golden', 'path to the golden-set JSON');
  const paid = args.flags.paid === true;

  const raw = JSON.parse(fs.readFileSync(goldenPath, 'utf8')) as { items?: GoldenFileItem[] };
  const items = (raw.items ?? []).filter((it) => it.lead && it.id);
  if (items.length === 0) {
    process.stderr.write('[eval] golden set is empty — fill tests/fixtures/judgment_golden.json (see the .example).\n');
    return 1;
  }

  const config = getActiveJudgmentConfig();
  const { llm, modelId } = buildJudgeLLM(paid);
  const cache = new InMemoryEnrichmentCache();
  const ctx = liveFreeHarvestContext({ tenantId: 'eval', cache, paidEnabled: paid });
  process.stderr.write(`[eval] ${items.length} golden companies · llm=${modelId ?? 'deterministic'}\n`);

  const predictions = new Map<string, JudgmentRecord>();
  for (let i = 0; i < items.length; i++) {
    const rec = await runJudgment(items[i].lead, ctx, { config, llm, modelId }, emptyBundle());
    predictions.set(items[i].id, rec);
    process.stderr.write(`[eval] ${i + 1}/${items.length} ${items[i].id} → target=${rec.verdetto_gap?.target} ${rec.verdetto_gap?.quadrant}\n`);
  }

  const report = evaluate(items, predictions);
  process.stdout.write('\n=== GOLDEN-SET REPORT ===\n');
  process.stdout.write(`n=${report.n}\n`);
  process.stdout.write(`target  precision=${report.target.precision}  recall=${report.target.recall}  f1=${report.target.f1}  (tp=${report.target.tp} fp=${report.target.fp} fn=${report.target.fn} tn=${report.target.tn})\n`);
  if (report.aAgreement !== undefined) process.stdout.write(`A agreement = ${report.aAgreement}   (which judge errs: A vs B, separately)\n`);
  if (report.bAgreement !== undefined) process.stdout.write(`B agreement = ${report.bAgreement}\n`);
  if (report.modelAgreement !== undefined) process.stdout.write(`business-model agreement = ${report.modelAgreement}\n`);
  process.stdout.write(`quadrant confusion (expected → predicted): ${JSON.stringify(report.quadrantConfusion)}\n`);
  process.stdout.write('\nReminder: with a strong A source OFF, A reads "unknown" → quadrants land on A?/fuffa and the thesis cannot be validated. Turn ON one A source per vertical first.\n');
  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((err) => {
    process.stderr.write(`[eval] fatal: ${(err as Error).message}\n`);
    process.exit(2);
  });
