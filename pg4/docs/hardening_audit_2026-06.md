# Pre-Openapi hardening audit — problems found + fixed (2026-06-16)

*A big audit before wiring Openapi ("prima risolviamo il resto"): 3 read-only agents
swept correctness, architecture-wiring, ops/logs/tests; findings verified against code
+ live logs. This is the honest map: REAL problems (fixed), NEUTRAL debt (verified
harmless), false alarms (verified against the source). €0, 817 tests green, not pushed.*

## What got FIXED

### P1 — wrong-entity VAT (the franchise/sister-brand class) — HIGH ✓
The franchise fix (2026-06-14) was INCOMPLETE: `companyNameMatches` used containment-OR-
Jaccard≥0.5, which still false-confirmed a **bare-brand sister** ("Metroquadro Srl"
{metroquadro} ⊆ "Immobiliare Metroquadro", Jaccard 0.5). A different-city same-brand
VAT cited in a footer could attach the wrong company's revenue @0.95.
**Fix (`field_registry.ts`):** require **≥2 shared distinctive tokens** to confirm
(exception: both names ARE the same single word, "Blurebus"=="Blurebus Srl"). A single
shared brand/surname token never confirms across distinct entities. `vatResolve` is now
**three-way**: ≥2 shared → confirm 0.95; exactly 1 shared → keep 0.6 **unconfirmed**
(ambiguous, NOT refused — avoids over-rejecting legit single-word domestic VATs, bug#3's
lesson); 0 shared with a returned name → foreign/refuse. Verified against all real cases:
Tecnocasa-franchisor ✗, Metroquadro-sister ✗, Metroquadro-correct ✓, Giglio owner-suffix
✓, Blurebus single-word ✓, Euganea ✓. Real-string goldens added.

### P2 — entity-guard generalized to ALL VAT-keyed fields — MED ✓
The wrong-entity guard lived only inline in the fatturato step. Extracted to a reusable
**`isWrongEntity(fetchedRegisteredName, lead)`** (refuses when the VAT's registered name
doesn't ≥2-match the lead). fatturato uses it; the disabled `pec.inipec_by_vat` carries a
written CONTRACT that activation MUST call it — so no future VAT-keyed field re-opens the
class.

### P3 — per-domain rate-limit on the website fetch path — HIGH ✓
`direct_fetch` had no limiter; `deepExtractFromSite` (homepage + 2 contact pages) inside
the pool (5 companies) could burst ~15 req/s to SMB sites — the bug#4 class on a new path.
**Fix (`deep_pages.ts`):** a per-**domain** `RateLimiter` (≤2 req/s, no burst) spaces
same-site fetches while different domains (the pool) stay parallel. Timing golden asserts
the spacing (503ms measured for homepage+contact).

### P6 — CLI/cascade split: contract + purity guard — MED ✓
The CLI enrich (`enrichment_pipeline` 6-stage ladder) is SEPARATE from the per-field
cascade (dev server) where the fixes live. Verified the CLI `FinancialStage` is a **pure
checksum skeleton** — it promotes a checksum-valid input VAT to `vat_code_final`@0.6 and
**never fetches fatturato**, so the franchise bug is NOT exposed via the CLI. The risk is
future. **Fix:** a written wrong-entity CONTRACT at `financial_stage.ts` deriveFromInput
(any future live lookup MUST route through the guarded per-field cascade) + a purity
guard test (`financial_stage.test.ts`: the stage never sets revenue/employees, <50ms, no
network) that fails if someone adds an un-guarded fetch.

## What was a FALSE ALARM (verified against the source — no change)

### P4 — Serper "19 calls, 0% success" — NOT a bug
`serper.ts` already distinguishes errors from empty correctly (Phase G.1): 401/403 →
ProviderBlockError, 429 → block, 5xx/4xx → transport error, only a **200 with empty
`organic`** counts as legit-empty. The 19 empties were 200s → Serper genuinely returned
no organic results for 19 obscure queries (a valid VAT key, else 401 would have thrown).
The `provider_dead` heuristic ("called, never succeeded") over-flags legit-all-empty — a
known, accepted heuristic limitation, not a silent-error bug. No code change.

## What is NEUTRAL DEBT (verified built-but-dormant — no action, deferred-activation)
`PgTenantDb`, `TenantLeadSink`, `enrichment_cache`, `ControlPlane`, the `_runs.jsonl→DB`
loader, multi-tenant isolation (schema + ControlPlane only; CLI is file-based), in-memory
persistence (dev server reseeds from JSONL). All have **zero live call-sites** (`grep
"new X"` clean), all marked deferred, **no data-loss path** (outputs deterministically
written to CSV/JSONL/logs). Activate per the production checklist; nothing to fix now.

### P5 — synthetic-fixture coverage — strategy documented (not a bulk fixture add)
Real-data golden coverage is partial BY DESIGN: SMB body-extractor pages are PII-heavy →
they are NOT committed as fixtures; the real-source gate for them is the **periodic live
probe** (`probe_precision`, `probe_vat_multiplier`, `audit_validation`) run before trusting
output at volume. The STRUCTURED parser (fatturatoitalia) — where the latent bugs lived —
DOES have real-captured goldens for the risk cases (euganea oldest-first year, dipendenti
bands) + the entity-guard real-string golden. A live DOM change is caught by the probe,
not a static fixture. This is the honest mitigation; no PII fixtures added.

## ACCEPTED BY DESIGN (noted, no fix)
email/social/VAT-candidate first-match (homepage-wins, documented); phone `phones[0]`
(deterministic, LOW); VIES no limiter (caller-gated, off the live path); graceful-drain
message on Ctrl-C (runs logged with exit code, cosmetic).

## Config hygiene (note)
`.env` is gitignored + untracked, no tracked secrets (verified). API keys imported from
pg3 should be rotated before any production use (the live path is €0/disabled-paid, so no
urgency now).

## Verification
817 tests green (+6 real-string goldens) · typecheck · lint · web tsc all clean. Live
re-audit on the franchise sample (Albignasego, Tecnocasa) confirms revenue honest-empty
post-fix with no over-rejection of legit confirms (`docs/precision_evidence/audit_HARDEN.json`).
€0 spent. Not pushed — owner holds push behind the 10-row source-check.

## Out of scope (next)
Openapi wiring (the cleared next step — its official VAT-by-identity structurally
eliminates the footer-VAT collision class P1/P2 harden); full CLI/cascade unification
(later dedicated pass); neutral-debt activation (production checklist).
