import { parseArgs, reqString } from './_args';
import { logger } from '../runtime/logger';

/**
 * `npm run benchmark -- --input tests/fixtures/sample_companies.csv`
 *
 * Phase 5 (best effort): runs pg4 enrich + compares against pg3 baseline.
 * Stub for now.
 */
async function main() {
  const args = parseArgs();
  const input = reqString(args, 'input');
  logger.info({ input }, '[benchmark] not yet implemented (Phase 5) — see IMPLEMENTATION_NOTES.md');
}

main().catch((err) => {
  logger.error({ err: err.message }, '[benchmark] failed');
  process.exit(1);
});
