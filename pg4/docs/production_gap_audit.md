# pg4 production readiness audit (2026-06-09)

> Audit eseguito da Claude Opus 4.7 su richiesta dell'operatore.
> Read-only — nessuna modifica al codice. Le sezioni di seguito
> riflettono lo stato del branch `pg4/phase-4.4-structure-cleanup`
> al commit `2c6722d`.

## Verdict
Mostly-ready for single-operator controlled production on validated provinces (BL/PD/VR/TV) and category "agenzie immobiliari". NOT general-purpose multi-operator production — gaps in observability persistence, scheduling, GDPR posture, schema versioning, and category/geo coverage block hand-off to a non-Marco operator running paying-client campaigns without supervision.

## Summary table
| category | state | blockers | nice-to-have |
|---|---|---|---|
| Reliability | strong | 0 | finer breaker probes; smoke test for enrich |
| Observability | weak | log persistence, run history, cost alerts | metrics export |
| Operational | partial | deploy target, secrets manager, scheduler, `run` cmd stub | systemd/launchd unit |
| Data quality | strong-ish | no schema version stamp | dedupe scale benchmark |
| Coverage | narrow | only 1 category curated; 12/110 provinces; Maps validated on 1 province | sector-keyword variants for other categories |
| Security & GDPR | weak | no GDPR posture / retention / right-to-deletion / audit log / secret rotation policy | CSP/headers N/A (no server) |
| Onboarding | good | none | architecture diagram is text-only |
| Code quality | strong | no test coverage measurement; no ESLint/Prettier | 50 `any` usages worth cleaning |

## Detailed findings

### Reliability
- [NICE] Smoke tests cover only PG live, DNS, VIES, SERP providers — no `enrich` end-to-end smoke against the real CSV→CSV shape on a tiny live sample (`tests/smoke/`). The whole enrich/finalize path is exercised only via mock-HTTP in unit. **Why it matters:** PG-live regression is caught; a Cheerio/Pino/Playwright dep bump that breaks the enrich pipeline shape would slip through CI. **Effort:** S.
- [NICE] `pg_live.ts:91-96` and `maps_live.ts:100-104` swallow navigation errors per-page/per-comune and continue. This is correct for resilience but no aggregate alert is emitted when failure rate exceeds X% in a run. Operator only sees individual `[pg_live] navigation error` lines. **Effort:** S.
- [NICE] No `process.on('SIGINT'/'SIGTERM')` handler in `src/cli/*.ts`. Ctrl-C drops mid-write; lock cleanup relies on the `finally` block. Works in practice (R13.1 max-age guard heals stuck locks in 12h) but a graceful shutdown that flushes the CostLedger summary and releases the lock cleanly would remove the 12h heal window for the common case. **Effort:** S.
- [SERIOUS] `runtime/cache.ts` is in-memory only; the architecture doc says "Redis adapter slot reserved" but the multi-run cache hits for repeated leads across runs is lost. Not a blocker for one-shot client jobs; is a blocker for re-running an enrich on the same raw to test a code change cheaply. **Effort:** M (or accept).
- [INFO] CircuitBreaker (`runtime/circuit_breaker.ts`) is well-designed with weighted failure kinds. Coverage is provider-router-only — Playwright page-load failures don't trip a breaker. If PG rate-limits the IP, scrape continues per-comune. **Effort:** M for adding a scrape-side breaker.

### Observability
- [BLOCKER] **Logger writes to stdout only** (`src/runtime/logger.ts:21`, `pino.destination(1)`). No file output, no rotation, no per-run log artifact. To keep run logs operators must remember `2>&1 | tee run.log`. A paying-client campaign whose enrich crashed at hour 3 has zero forensic evidence if the operator forgot to tee. **Effort:** S — add `LOG_FILE` env that pipes Pino to a rotating destination via pino's `transport.targets`.
- [BLOCKER] **No run history index.** Each run writes its own CSV/JSONL/ledger but there is no `runs/index.jsonl` correlating run_id → command → inputs → outputs → exit-status → wall-time. Forensic question "what runs happened last week and which cost what" requires `find output/ -name '*.cost-ledger.jsonl' | xargs grep summary`. **Effort:** S — append one line per run to `output/_runs.jsonl`.
- [BLOCKER] **No cost-cap or precision alerting.** `--run-cost-ceiling-eur` is the hard stop, but no notification fires when it's hit; the operator only sees a log line in stdout. No Slack/email/webhook hook. For an operator running paid Serper on a client job overnight, hitting €0.20 cap silently means the rest of the leads are free-only and nobody knows. **Effort:** S — env-gated webhook in `CostLedger.flushSummary()`.
- [SERIOUS] No metrics emission (Prometheus, statsd, OTel) — `grep` for `metrics|prom|gauge` returns nothing in `src/`. Acceptable for the operator-only model; not acceptable for an SLA tier. **Effort:** M.
- [INFO] Ledger JSONL (`cost_ledger.ts`) IS the durable per-call metric — it's just not aggregated across runs.

### Operational
- [BLOCKER] **No deployment story documented.** `production_runbook.md` assumes local invocation (`pnpm run scrape`, manual ssh-equivalent). No systemd unit, no Docker image, no Vercel/Fly/Render template, no documented machine-spec floor. A second operator on a different laptop has no path to "same machine as Marco" reproducibility beyond `pnpm install`. **Effort:** M — minimal Dockerfile + a "expected RAM/CPU/disk" stanza.
- [BLOCKER] **No scheduling.** Manual CLI only. A paying-client weekly refresh has to live in cron on Marco's laptop. No documented cron/launchd recipe; no GitHub Actions schedule job. **Effort:** S — a sample launchd `.plist` + a sample GH Actions schedule (with the explicit no-RUN_SMOKE caveat).
- [BLOCKER] **Secrets management is `.env` only.** No 1Password/SOPS/Doppler/SSM integration, no rotation runbook. `_CREDENZIALI/` vault exists at the Marco-personal level but pg4 has no awareness. A second operator who needs `SERPER_API_KEY` must be sent the file out-of-band. **Effort:** decision-led, then S.
- [SERIOUS] **`run` command is a stub** (`src/cli/run.ts:21`). Operator must hand-chain `scrape` then `enrich`, remembering the exact `--out` mapping. This is the single highest-friction step for hand-off. **Effort:** S — wire the two existing functions; both are already exported.
- [INFO] Recovery procedures (§7) and "what NOT to do" (§8) in `production_runbook.md` are mature and battle-tested (real-incident reference 2026-06-01).
- [INFO] No `pnpm validate:output` script in `package.json` (runbook §4.5 notes this is "in progress").

### Data quality
- [SERIOUS] **No schema version field on outputs.** `RAW_CSV_COLUMNS` / `ENRICHED_CSV_COLUMNS` are "append-only by convention" (architecture.md invariant 8) but there's no `_schema_version` column in CSV/JSONL nor a `meta` line in the ledger. A downstream consumer reading a year-old enriched CSV cannot programmatically detect whether `financial_*` columns exist; they have to inspect the header. **Effort:** S — single column or `# version:N` first JSONL line.
- [SERIOUS] **No large-scale dedupe verification.** `Deduplicator` (`src/discovery/deduper.ts`) has unit tests but no published benchmark on a 5k+ row province showing collision rate / false-collapse rate. PD ran 437 unique from 900 cards — the merge correctness was not audited. **Effort:** M — sample audit of N=50 merged records per scale tier.
- [INFO] `validate_output.ts` is solid (CSV/JSONL row alignment, mojibake, exactly-one ledger summary, exactly-one run_id, cost cap). Coverage looks comprehensive at 368 lines.
- [INFO] No cross-province leak handling, but the run model is "one province per `--out`" so the leak surface is the dedupe key collision, not orchestration.

### Coverage
- [BLOCKER] **Only 1 category fully wired for Maps full-coverage.** `src/discovery/sources/maps_coverage.ts` `MAPS_FULL_COVERAGE_VARIANTS` has exactly one key: `'agenzie immobiliari'`. Other categories silently fall back to single-query (and the operator gets a warn log they may miss). For a client who orders "ristoranti TO" you get a half-recall Maps run with no signal it's degraded. **Effort:** M — curate variant tables per common Italian SMB category (5-10 verticals).
- [BLOCKER] **Province coverage is 12/110.** `italy_geo.ts` has `PROVINCE_COMUNI` for BL/VR/VE/PD/VI/TV/RO/BS/MN/MI/TO/RM only. Any other province requires the operator to pass `--comuni "C1,C2,…"` by hand. **Effort:** M — ISTAT comuni dataset → curated lists keyed to province capital + top N by population.
- [SERIOUS] **Maps stability at >50 comuni/run is unverified.** Validated runs ≤ 14 comuni per province (PD/VR/TV/BL counts). Stability evidence does not exist for a 50+ comune run; the Playwright session restarts every 5 navigations (`browserRefreshEvery: 5`) but accumulated cap_likely / no_feed rate at scale is unmeasured. **Effort:** M — one timed dry run on a curated MI/RM list.
- [INFO] R11/R12/R14/R15 evidence is well-documented in `docs/recalibration_r*.md`.

### Security & compliance
- [BLOCKER] **No documented GDPR posture.** pg4 outputs contain personal data of Italian SMB principals (P.IVA which can be a sole-prop personal tax ID, phone numbers including mobile, names embedded in company_name for *Studio* / *di Rossi* firms). Zero references to GDPR, legal-basis (Art. 6(1)(f) legitimate-interest expected), data-subject right-to-deletion, retention period, or DPIA in `src/` or `docs/`. For a client deliverable this is reputational + regulatory risk. **Effort:** decision-led; then a `GDPR.md` + a `--retention-days` enforcer.
- [BLOCKER] **No data-retention enforcement.** `output/` accumulates client CSVs forever. No `--retention-days`, no archive job, no documented "delete client X after 30 days post-delivery." **Effort:** S — a `scripts/prune_output.ts` keyed on file mtime + a runbook entry.
- [BLOCKER] **No audit log.** `cost_ledger.jsonl` records provider calls but there is no "who ran what command when on which inputs" trail. An operator deletes an output, you cannot reconstruct what was generated. **Effort:** S — same `output/_runs.jsonl` proposed under Observability solves both.
- [SERIOUS] **No secret rotation policy.** `.env` is the only mechanism; no documented "rotate SERPER_API_KEY every 90 days" runbook. **Effort:** S, decision-led.
- [INFO] `.gitignore` correctly excludes `.env`, `output/`, `.browser-state/`. Verified clean.
- [INFO] No web surface = no CSP/headers concerns. No telemetry leak surface either.

### Onboarding
- [INFO] **Operator playbook exists** (`docs/operator_playbook.md`, ~790 lines, last updated 2026-06-09). Covers 9 scenarios with intent → exact command → expected output → verification → recovery, in Italian. This is unusually mature.
- [INFO] **Production runbook exists** (`docs/production_runbook.md`, 22kB) with maturity self-assessment, verified CLI flags, copy-pasteable commands, go/no-go checks, recovery procedures, what-NOT-to-do (with real incident reference), and a pre-run checklist.
- [INFO] **Architecture doc** (`docs/architecture.md`) explains folder responsibilities, command flow, and 9 invariants. Text only — no visual diagram, but the ASCII flow in README + architecture is sufficient.
- [INFO] API surface stability: the `Lead` type is the canonical contract; `RAW_CSV_COLUMNS` / `ENRICHED_CSV_COLUMNS` documented as append-only.

### Code quality
- [SERIOUS] **No test coverage measurement.** No `vitest.config.ts`, no `coverage` script in `package.json`, no `@vitest/coverage-v8` dep. 610 tests in `tests/unit` across 56 files, 4 smoke tests, 0 reported line/branch coverage. **Effort:** S — add `vitest --coverage` config + threshold gate in CI.
- [SERIOUS] **No ESLint / no Prettier config.** Style enforcement is by convention only. A second operator's editor settings could re-flow files on save. **Effort:** S.
- [NICE] **50 occurrences of `any`** in `src/` (rough grep) but **0 `@ts-ignore` / `@ts-expect-error` / `as any`** — strict mode is honoured cleanly. The `any` count is mostly in error/meta interfaces and is benign.
- [INFO] **0 `TODO` / `FIXME` / `XXX` / `HACK`** in `src/`. Exceptionally clean.
- [INFO] `tsconfig.json` is strict (`strict: true`, `noImplicitAny`, `strictNullChecks`, `noImplicitReturns`, `noFallthroughCasesInSwitch`).
- [INFO] **No Dependabot/Renovate config.** Dependencies are pinned via pnpm-lock; no automated update PRs. **Effort:** S.
- [INFO] 84 source `.ts` files, ~11k LOC. Module boundaries cleanly respected.

## Quickwins (under 1h each)
1. **Add `LOG_FILE` env support** in `src/runtime/logger.ts` so each run emits `output/<run_id>.log` automatically — closes the "operator forgot to `tee`" gap and the run-history gap simultaneously.
2. **Append `output/_runs.jsonl` line per run** in `src/cli/scrape.ts` and `src/cli/enrich.ts` `finally` block: `{run_id, command, args, started_at, finished_at, exit_code, out_paths}`. Doubles as audit log.
3. **Wire `src/cli/run.ts`** — `scrape` and `enrich` are already exported functions; the stub can become real in 30 lines. Closes the single highest hand-off friction.
4. **Add `pnpm validate:output`** to `package.json` `"scripts"` (runbook §4.5 says this is "in progress this sprint"). One-line change.
5. **Add `vitest --coverage` config + CI step**. Establishes a quality baseline number even before setting a threshold.
6. **Add `_schema_version: 1` column** to `RAW_CSV_COLUMNS` and `ENRICHED_CSV_COLUMNS`. Future-proofs downstream consumers against the next append.

## Blockers requiring operator decisions
- **Deployment target.** Local laptop only? Containerized? Hosted? Each implies a different runbook surface (Docker-compose vs systemd vs GH Actions vs Fly.io). Until decided, the deploy story can't be written.
- **Secrets manager.** `.env` only, or 1Password/SOPS/Doppler/AWS SSM? Drives the secret-rotation runbook.
- **Scheduling target.** cron on a Mac, launchd, GitHub Actions schedule, or a hosted scheduler? Affects log capture, retry-on-failure, and notification path.
- **GDPR posture for client-deliverable lead data.** Need an explicit decision on (1) legal basis (Art. 6(1)(f) legitimate interest with balancing test, or contract with client who is data controller); (2) retention period; (3) right-to-deletion mechanism (lookup by phone/P.IVA across delivered files); (4) DPIA needed yes/no; (5) processor agreement with Serper/PG (Serper sees lead queries which may include personal names).
- **Cost-alert channel.** Slack webhook? Email via Resend? Telegram? Drives the 1h cost-monitor patch shape.
- **Category/geo expansion priority.** Maps-full-coverage curation is per-category manual work; pick the next 5 verticals before doing the work.
- **SLA target for paying clients.** "Best effort delivery within 7 business days" vs. "hourly fresh data with 99% uptime" — current state supports the former, not the latter. The blockers above only matter at the higher tier.
