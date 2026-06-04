import { parseArgs, reqString, optString, hasHelp } from './_args';
import { logger } from '../runtime/logger';
import { runFixtureMode, runLiveMode } from '../discovery/scrape_pipeline';
import { acquireOutputLock } from '../runtime/output_lock';

/**
 * scrape — Phase 4 CLI (thin wrapper).
 *
 * Argument parsing + flag validation + dispatch only. All orchestration
 * (fixture mode + live mode + comuni resolution + dedupe + output)
 * lives in `src/discovery/scrape_pipeline.ts` so it can be exercised
 * by tests without touching the CLI.
 *
 * Two coexisting modes:
 *   1) FIXTURE (offline, deterministic):
 *        pnpm run scrape -- --fixture pg=path1.html,maps=path2.html \
 *           --category "agenzie immobiliari" --out output/raw.csv
 *
 *   2) LIVE (Playwright):
 *        pnpm run scrape -- --category "..." --province BL --out output/raw.csv
 *        pnpm run scrape -- --category "..." --comuni "C1,C2,C3" --out output/raw.csv
 *
 * Live mode skips Maps unless `--maps` is passed (PG-only by default,
 * because Maps' Cloudflare/consent surface needs more hardening).
 */

async function main() {
  const args = parseArgs();
  if (hasHelp(args)) {
    printUsage();
    return;
  }
  const out = reqString(args, 'out', 'e.g. output/raw.csv');
  const category = optString(args, 'category');
  const fixtureFlag = optString(args, 'fixture');

  if (fixtureFlag) {
    const outputLock = acquireOutputLock(out, { command: 'scrape', mode: 'fixture', fixture: fixtureFlag });
    try {
      await runFixtureMode({
        out,
        category,
        fixture: fixtureFlag,
        sourceFlag: optString(args, 'source'),
      });
      return;
    } finally {
      outputLock.release();
    }
  }

  if (!category) {
    throw new Error('Live mode requires --category. Pass --fixture <path> for offline mode.');
  }
  // R5 — `--coverage` flag. Accept 'default' (single query) or 'full'
  // (sector-keyword variants per comune). Anything else is rejected
  // so a typo doesn't silently fall back to default and surprise
  // the operator with under-coverage.
  const coverageRaw = optString(args, 'coverage');
  let mapsCoverage: 'default' | 'full' | undefined;
  if (coverageRaw !== undefined) {
    if (coverageRaw !== 'default' && coverageRaw !== 'full') {
      throw new Error(`--coverage must be "default" or "full", got "${coverageRaw}"`);
    }
    mapsCoverage = coverageRaw;
  }
  const outputLock = acquireOutputLock(out, { command: 'scrape', mode: 'live', category });
  try {
    await runLiveMode({
      out,
      category,
      province: optString(args, 'province'),
      region: optString(args, 'region'),
      comuniCsv: optString(args, 'comuni'),
      maxPages: parseIntOrUndefined(optString(args, 'max-pages')),
      interDelayMs: parseIntOrUndefined(optString(args, 'inter-delay-ms')),
      runMaps: !!args.flags['maps'],
      mapsCoverage,
      headless: args.flags['headless'] !== 'false',
      checkpointPath: optString(args, 'checkpoint'),
      restartEvery: parseIntOrUndefined(optString(args, 'restart-every')),
      fresh: !!args.flags['fresh'],
      allowMissingJsonl: !!args.flags['allow-missing-jsonl'],
    });
  } finally {
    outputLock.release();
  }
}

function printUsage(): void {
  process.stdout.write(`Usage:
  pnpm run scrape -- --fixture pg=<pg.html>,maps=<maps.html> --category "<category>" --out output/raw.csv
  pnpm run scrape -- --category "<category>" --province BL --out output/raw.csv

Modes:
  --fixture <spec>          Offline parser mode. Use pg=path,maps=path or a single path plus --source.
  --source <pg|maps>        Source type when --fixture is a single path.
  --category <text>         Business category to scrape.
  --province <CC>           Live mode province code.
  --comuni "A,B,C"          Live mode explicit municipality list.
  --maps                    Also scrape Google Maps in live mode.
  --max-pages <n>           Per-municipality PG page cap.
  --checkpoint <path>       Resume checkpoint path.
  --fresh                   Clear previous output/checkpoint for this target.
  --headless false          Show browser in live mode.
  --out <path>              Required raw CSV output path.
`);
}

function parseIntOrUndefined(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

main().catch((err) => {
  logger.error({ err: err.message, stack: err.stack }, '[scrape] failed');
  process.exit(1);
});
