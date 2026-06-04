import { parseArgs, reqString, optString, hasHelp } from './_args';
import { logger } from '../runtime/logger';

/**
 * `pnpm run run -- --category "X" --province MI --out output/campaign`
 *
 * Phase 1 stub — chains scrape → enrich.
 * Phase 4 wires the actual scraper; for now it just describes intent.
 */
async function main() {
  const args = parseArgs();
  if (hasHelp(args)) {
    printUsage();
    return;
  }
  const category = reqString(args, 'category');
  const outBase = reqString(args, 'out');
  const province = optString(args, 'province');
  const region = optString(args, 'region');

  logger.info(
    { category, province, region, outBase },
    '[run] end-to-end pipeline not yet wired (Phase 4) — use scrape + enrich separately'
  );
}

function printUsage(): void {
  process.stdout.write(`Usage:
  pnpm run run -- --category "<category>" --province BL --out output/campaign

Status:
  The command is reserved for the end-to-end scrape -> enrich pipeline.
  In the current pg4 runtime it validates arguments and logs the intended campaign.
  Use scrape and enrich separately for production runs until this command is wired.

Flags:
  --category <text>       Required business category.
  --province <CC>         Province code for the scrape stage.
  --region <name>         Optional region label.
  --out <path>            Required campaign output base path.
`);
}

main().catch((err) => {
  logger.error({ err: err.message }, '[run] failed');
  process.exit(1);
});
