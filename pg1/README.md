# PG1 Legacy Pipeline

`pg1` is a legacy domain-resolution pipeline kept for reference and limited maintenance.

Current intent:
- active runtime: `pg3`
- `pg1` is not the canonical scraping or enrichment path
- keep `pg1` stable enough for targeted legacy tests and historical comparison

Main entrypoints:
- `src/cli.ts`
- `src/pipeline/index.ts`

Maintenance policy:
- prefer test/config fixes over new feature work
- do not duplicate new `pg3` runtime behavior here unless explicitly required
