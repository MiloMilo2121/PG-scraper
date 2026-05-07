import path from 'path';
import { parseArgs, reqString, optString } from './_args';
import { logger } from '../runtime/logger';
import { readCsvAsLeads } from '../io/csv_reader';
import { OutputManager } from '../io/output_manager';
import { createRun, createPerLeadContext } from '../runtime/run_context';
import { buildProviderCatalog } from '../providers/provider_catalog';
import { runEnrichmentPipeline } from '../enrichment/enrichment_pipeline';

/**
 * `npm run enrich -- --input output/raw.csv --out output/enriched.csv`
 *
 * Phase 2 vertical slice: read CSV → normalize → dedupe → check input website
 * via direct_fetch → write CSV+JSONL with status + reason_code on every row.
 */
async function main() {
  const args = parseArgs();
  const input = reqString(args, 'input', 'path to raw CSV');
  const csvOut = reqString(args, 'out', 'path to enriched CSV');
  const jsonlOut = csvOut.replace(/\.csv$/i, '') + '.jsonl';

  const ledgerPath = optString(args, 'ledger-path') ?? csvOut.replace(/\.csv$/i, '') + '.cost-ledger.jsonl';
  const ceilingArg = optString(args, 'cost-ceiling-eur');
  const costCeiling = ceilingArg ? Number(ceilingArg) : undefined;
  // Phase G — paid providers gate. Default DENY: paid is off unless
  // `--enable-paid` is passed. The cost-ceiling-eur=0 path also
  // forces paid off as an extra safety, so an operator can run
  // "free regression" by setting the ceiling to 0 even if they
  // forgot to drop --enable-paid.
  const enablePaid = !!args.flags['enable-paid'];
  const runCeilingArg = optString(args, 'run-cost-ceiling-eur');
  const runCostCeilingEur = runCeilingArg ? Number(runCeilingArg) : undefined;
  const paidEnabled = enablePaid && (costCeiling === undefined || costCeiling > 0);
  if (enablePaid && !paidEnabled) {
    logger.warn(
      { costCeiling },
      '[enrich] --enable-paid is ignored because --cost-ceiling-eur is 0; force-OFF paid for this run',
    );
  }
  const run = createRun({
    ledgerJsonlPath: ledgerPath,
    costCeilingEur: costCeiling,
    paidEnabled,
    runCostCeilingEur,
  });
  const router = buildProviderCatalog(run.ledger);

  const output = new OutputManager(csvOut, jsonlOut, 'enriched');
  logger.info(
    { runId: run.ctx.runId, input, csvOut, paidEnabled, costCeilingEur: costCeiling, runCostCeilingEur },
    '[enrich] starting',
  );

  let total = 0;
  let withWebsite = 0;
  let errors = 0;
  const inFlight: Promise<void>[] = [];
  const concurrency = run.cfg.pipeline.concurrency;

  for await (const item of readCsvAsLeads(input)) {
    total += 1;
    const task = (async () => {
      const perLead = createPerLeadContext(run);
      try {
        const result = await runEnrichmentPipeline({
          run,
          perLead,
          router,
          lead: item.lead,
          ingestError: item.ingestError,
        });
        if (result.lead.official_website) withWebsite += 1;
        await output.write(result.lead, { stage_outcomes: result.stage_outcomes });
      } catch (err) {
        errors += 1;
        logger.error({ line: item.lineNumber, err: (err as Error).message }, '[enrich] row failed');
        await output.write({ ...item.lead, status: 'ERROR', reason_code: 'ERROR_INTERNAL', errors: [{ stage: 'pipeline', message: (err as Error).message }] });
      }
    })().finally(() => {
      const idx = inFlight.indexOf(task);
      if (idx >= 0) inFlight.splice(idx, 1);
    });
    inFlight.push(task);
    if (inFlight.length >= concurrency) {
      await Promise.race(inFlight);
    }
  }

  await Promise.all(inFlight);
  await output.close();
  run.ledger.flushSummary({
    leads_processed: total,
    leads_with_website: withWebsite,
    leads_errored: errors,
    cost_per_lead_eur: total > 0 ? run.ledger.getTotal() / total : 0,
    cost_ceiling_eur: run.ctx.costCeilingEur,
    breaker: router.describeBreaker(),
  });

  logger.info(
    {
      total,
      with_website: withWebsite,
      errors,
      output_csv: path.resolve(csvOut),
      output_jsonl: path.resolve(jsonlOut),
      ledger_jsonl: path.resolve(ledgerPath),
      duration_ms: Date.now() - run.ctx.startedAt,
    },
    '[enrich] done'
  );
}

main().catch((err) => {
  logger.error({ err: err.message, stack: err.stack }, '[enrich] fatal');
  process.exit(1);
});
