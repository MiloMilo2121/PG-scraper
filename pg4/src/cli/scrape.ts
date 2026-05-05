import { parseArgs, reqString, optString } from './_args';
import { logger } from '../runtime/logger';

/**
 * `npm run scrape -- --category "X" --province MI --out output/raw.csv`
 *
 * Phase 1: stub — prints intent and exits 0.
 * Phase 4: wire the live scraper (PG + Maps).
 */
async function main() {
  const args = parseArgs();
  const category = reqString(args, 'category', 'e.g. "agenzie immobiliari"');
  const out = reqString(args, 'out', 'e.g. output/raw.csv');
  const province = optString(args, 'province');
  const region = optString(args, 'region');
  const limit = optString(args, 'limit');

  logger.info(
    { category, province, region, out, limit },
    '[scrape] command parsed — scraper not yet implemented (Phase 4)'
  );
  logger.info('Run `npm run enrich -- --input <existing.csv>` to enrich an existing CSV today.');
}

main().catch((err) => {
  logger.error({ err: err.message }, '[scrape] failed');
  process.exit(1);
});
