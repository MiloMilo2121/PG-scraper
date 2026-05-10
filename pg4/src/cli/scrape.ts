import { parseArgs, reqString, optString } from './_args';
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
 *        npm run scrape -- --fixture pg=path1.html,maps=path2.html \
 *           --category "agenzie immobiliari" --out output/raw.csv
 *
 *   2) LIVE (Playwright):
 *        npm run scrape -- --category "..." --province BL --out output/raw.csv
 *        npm run scrape -- --category "..." --comuni "C1,C2,C3" --out output/raw.csv
 *
 * Live mode skips Maps unless `--maps` is passed (PG-only by default,
 * because Maps' Cloudflare/consent surface needs more hardening).
 */

async function main() {
  const args = parseArgs();
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

function parseIntOrUndefined(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

main().catch((err) => {
  logger.error({ err: err.message, stack: err.stack }, '[scrape] failed');
  process.exit(1);
});
