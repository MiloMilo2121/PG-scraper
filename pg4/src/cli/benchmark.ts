import { parseArgs, reqString, hasHelp } from './_args';
import { logger } from '../runtime/logger';

/**
 * `pnpm run benchmark -- --input tests/fixtures/sample_companies.csv`
 *
 * Phase 5 (best effort): runs pg4 enrich + compares against pg3 baseline.
 * Stub for now.
 */
async function main() {
  const args = parseArgs();
  if (hasHelp(args)) {
    printUsage();
    return;
  }
  const input = reqString(args, 'input');
  logger.info({ input }, '[benchmark] not yet implemented (Phase 5) — see IMPLEMENTATION_NOTES.md');
}

function printUsage(): void {
  process.stdout.write(`Usage:
  pnpm run benchmark -- --input tests/fixtures/sample_companies.csv

Status:
  Phase 5 is a placeholder in code. The current pg3-vs-pg4 evidence is documented
  in BENCHMARK.md from existing pg3 benchmark logs and pg4 measurements still marked TBD.

Flags:
  --input <path>      Required CSV input for the future benchmark runner.
`);
}

main().catch((err) => {
  logger.error({ err: err.message }, '[benchmark] failed');
  process.exit(1);
});
