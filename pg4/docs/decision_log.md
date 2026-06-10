# pg4 decision log — production-readiness pass (2026-06-10)

Conservative defaults chosen autonomously during the hardening pass.
Each entry lists the alternatives and the migration path. None of these
are irreversible; all are config- or flag-gated.

## Reality-vs-plan discrepancies noted at Phase 0

1. `validate:output` script **already existed** in package.json (added by a
   concurrent session after the gap audit was written). Phase B.2 therefore
   only wires automatic post-run invocation.
2. `.env.example` **already documents** every EnvSchema variable. Phase B.4
   only appends the new observability variables.
3. `Checkpoint.set()` **already flushes synchronously** on every write —
   the "flush checkpoint on shutdown" requirement is satisfied by design;
   the graceful-shutdown work only needs to stop the loop and let the
   natural path complete.

## A.1 — Per-run log file

- **Default:** every CLI run writes a JSONL log to `<out>.log.jsonl`
  alongside the outputs. `LOG_FILE=<path>` overrides the location;
  `LOG_FILE=off` disables.
- **Alternatives considered:** opt-in only (operator forgets, loses
  forensics — rejected); rotating global log dir (adds config surface and
  detaches logs from the run artifacts they describe — rejected).
- **Migration:** set `LOG_FILE` env in the scheduler unit to centralize
  logs; or pipe to a shipper later. No call-site changes needed.

## A.2 — Run history location

- **Default:** `_runs.jsonl` in the same directory as the run's `--out`
  file. Underscore prefix sorts it apart from data files; the validator
  and retention sweep ignore it.
- **Alternatives:** single fixed `output/_runs.jsonl` (breaks when the
  operator writes outputs elsewhere); SQLite (new dependency, stateless-core
  invariant pressure).
- **Migration:** the file is plain JSONL — trivially importable into
  DuckDB/Postgres later.

## A.3 — Preflight canary

- **Default:** preflight ON for every live scrape; canary query is
  "agenzie immobiliari" / Padova (densest validated comune since R6).
  `--skip-preflight` opts out per-run.
- **Alternatives:** canary derived from the run's own category/comune
  (first-run categories have no known-good baseline — rejected);
  preflight as separate CLI (operator forgets — rejected).
- **Migration:** when a second category is validated at province scale,
  move `PREFLIGHT_CANARY` to config.

## A.4 — Yield anomaly threshold

- **Default:** warn when a comune yields < 30% of its historical average
  for the same category; advisory only (marks `suspect: true` in the run
  record, never fails the run). No history → no check.
- **Alternatives:** fail the run (false positives on genuinely shrinking
  markets — rejected); median instead of mean (fine, revisit with more
  history).

## A.5 — Notifier

- **Default:** `NOTIFY=local` — structured warn-level log line (lands in
  the run log file) + best-effort macOS `osascript` notification.
  `NOTIFY=off` silences.
- **OPERATOR DECISION PENDING:** alert channel (Slack webhook / Telegram /
  email). The `Notifier` interface takes one implementation + one line in
  `createNotifier` to add; call sites are final.
- **Per-lead ceiling events are notified once per run** (first occurrence);
  the total count lands in the ledger summary and run record. Rationale:
  many leads legitimately exhaust their budget; N pings would be spam.

## B.3 — Exit codes

- `0` ok · `1` partial (enrich row errors) · `2` fatal · `3` preflight
  failed · `130` interrupted. Stable contract for schedulers.
- pg4 CLIs have never prompted; `--non-interactive` is accepted as an
  inert flag by the parser (any unknown `--flag` parses as boolean true)
  and documented as such rather than implemented as special behavior.

## B.5 — Graceful shutdown

- First SIGINT/SIGTERM: abort signal → cooperative drain (in-flight leads
  finish, outputs close, ledger summary + run record written, lock
  released) → natural exit 130. Watchdog force-exits after 45 s if the
  drain wedges; a second signal force-exits immediately. The force path
  writes a fallback run record but may leave a partially flushed CSV —
  accepted as the escape hatch.

## B.1 — `run` command output layout

- **Default:** `--out <base>` produce `<base>_raw.csv`, `<base>_enriched.csv`
  (+ jsonl/ledger), `<base>.log.jsonl`. Ogni stage acquisisce il proprio
  output lock (stessa protezione dei comandi separati).
- **Alternative:** dirigere tutto in una directory per-campagna (più file
  da spostare per il delivery — rinviato).

## B.2 — Validazione automatica post-run

- **Default:** `validateOutputs()` gira a fine scrape (flavor raw) e fine
  enrich (flavor enriched). WARN-ONLY: un fallimento è loggato + notificato
  ma non cambia l'exit code — gli output sono già su disco e nasconderli
  non aiuta l'operatore.
- **Alternative:** exit code dedicato per validation-failed (rompe la
  semantica "exit≠0 = run non completato" — rifiutato per ora).

## B.3 — Scheduler

- **OPERATOR DECISION PENDING:** nessuno scheduler installato. Esempi
  pronti (launchd, cron, GH Actions commentato) in
  `docs/scheduling_examples.md`. CLI già non-interattivi by design.

## B.4 — Secrets

- **Default:** `.env` resta il meccanismo (conservativo). `assertPaidSecrets()`
  fallisce fast e nominando la variabile mancante quando `--enable-paid` è
  passato senza alcun provider paid usabile.
- **Scan eseguito (2026-06-10):** nessuna chiave key-shaped nel working
  tree pg4, nella history git dei path pg4, né a HEAD dell'intero repo;
  `.env` mai committato. Nessun finding CRITICAL.
- **OPERATOR DECISION PENDING:** upgrade a secrets manager (1Password /
  SOPS / Doppler) per uso multi-operatore.
