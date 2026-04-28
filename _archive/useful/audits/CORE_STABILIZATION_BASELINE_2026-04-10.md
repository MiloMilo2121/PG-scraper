# Core Stabilization Baseline — 2026-04-10

Branch di lavoro: `codex/core-stabilization`

## Toolchain osservato prima dei fix

- `node` trovato in due versioni locali:
- `/opt/homebrew/bin/node` = `v24.10.0`
- `/usr/local/bin/node` = `v22.14.0`
- `better-sqlite3` risultava compatibile con Node 22 e incompatibile con Node 24 (`NODE_MODULE_VERSION 127` vs `137`).

## Baseline PG3 prima della stabilizzazione

Runtime canonico usato per la baseline: `Node 22.14.0`

### `pg3`

- `typecheck`: `PASS`
- `test:unit`: `FAIL`
  - stato: `66/67` test files verdi, `209/210` test verdi
  - failure coerente con policy: `tests/unit/search-provider-compat.test.ts` ancora fissava `paid-first`
- `test:smoke`: `PASS`

### Osservazione critica pre-fix

- con `Node 24.10.0`, i test DB fallivano già all'import del modulo SQLite per ABI mismatch e open a import-time.
- con `Node 22.14.0`, lo smoke passava ma il runtime restava non riproducibile senza un pin esplicito della versione Node.

## Benchmark

- benchmark controllato `50-100` record non eseguito nel freeze iniziale.
- motivo: nel repo era presente solo l'output storico `pg3/bench_100_v6_results.csv`, non un input benchmark canonico già documentato per il rerun iniziale.
- la validazione finale viene eseguita dopo l'integrazione dei fix sul core.
