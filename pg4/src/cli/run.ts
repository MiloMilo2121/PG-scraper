import { parseArgs, reqString, optString } from './_args';
import { logger } from '../runtime/logger';

/**
 * `npm run run -- --category "X" --province MI --out output/campaign`
 *
 * Phase 1 stub — chains scrape → enrich.
 * Phase 4 wires the actual scraper; for now it just describes intent.
 */
async function main() {
  const args = parseArgs();
  const category = reqString(args, 'category');
  const outBase = reqString(args, 'out');
  const province = optString(args, 'province');
  const region = optString(args, 'region');

  logger.info(
    { category, province, region, outBase },
    '[run] end-to-end pipeline not yet wired (Phase 4) — use scrape + enrich separately'
  );
}

main().catch((err) => {
  logger.error({ err: err.message }, '[run] failed');
  process.exit(1);
});
