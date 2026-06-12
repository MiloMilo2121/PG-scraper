# Official-data spine (Phase 3) — Build Report

*The moat: VAT-as-master-key → revenue/employees from authoritative Italian
sources, free. What was wired, the measured hit-rates, the INI-PEC decision.
2026-06-12.*

## ⚠️ CORRECTION (2026-06-12) — wrong-year bug found by sample-check, fixed

The first build of this spine shipped a **systematic wrong-year bug** in the
revenue extraction, caught by Marco's manual sample-check (the exact discipline
the whole project exists to enforce). The numbers in the original demo
(€35.550 · €630.283 · €35.291) were the companies' **2020** figures, not the
most recent year — **retracted**.

**Root cause (confirmed on the real HTML, not guessed):** fatturatoitalia's
chart arrays are published **OLDEST-FIRST**. For P.IVA 02440120281:
`labelChart=['2020','2021','2022','2023','2024']`,
`datiChartFatturato=[35550,24903,53822,37769,51619]`. The parser did
`history.find(first positive)` → `history[0]` = 2020 (€35.550) for **every**
company. It was systematic, not conditional.

**Fix:** anchor on `max(year)` (most recent labeled year), never on array
position (`fatturato_italia_parser.ts`). **Golden regression test** locks it:
Euganea 02440120281 → € 51.619 (2024), and must never return € 35.550 again.
The pre-existing parser fixture was newest-first, so the test passed while the
real (oldest-first) site was wrong — the fixture didn't match reality. The new
golden fixture uses the real oldest-first data.

**Corrected, source-verified values** (`docs/measurement_evidence/fatturato_year_fix_evidence.txt`):
- Euganea 02440120281 → **€ 51.619 (2024)** — matches the source exactly (was €35.550).
- Metroquadro 02553730280 → **€ 1.715.785 (2024)** (was €630.283); parsed
  2022=€537.000 matches Marco's independent external check exactly.
- 02580520282 → **€ 16.496 (2024)** (was €35.291).

**Two related findings, both resolved:**
- *Revenue without a visible P.IVA* (Bordignon Service, 3b Srl, …): NOT a
  wrong-company name-match — `fetchFatturatoItalia` is **VAT-only** (URL
  `fatturatoitalia.it/<vat>`, checksum-gated), it can never match by name. Those
  companies have an **input `vat_code`** (668/1492 do); `resolveVat` used it, so
  the revenue is correct for that VAT — the column just showed the (empty)
  enriched `vat_code_final`. Fixed: the P.IVA column now shows
  `vat_code_final ?? vat_code`, so every revenue shows its VAT.
- *Confidence nuance (honest limit):* revenue keyed on the **input** scrape VAT
  is lower-confidence than revenue keyed on the firm's **own-site** VAT — the
  input VAT is unverified (a mis-scraped but checksum-valid VAT would fetch a
  different company). Both are checksum-valid; a future improvement is to
  VIES-validate the input VAT before trusting it for firmographics.

The moat *concept* holds (VAT→official-data chain is valid, the VAT match is
correct, the source has the right number) — but the demo evidence was wrong and
is retracted; the extraction is now fixed + regression-locked.

---


## What was wired (REAL, free, network)

The per-field framework's dormant registry tiers are now real steps:

| Field | Step | Source | Cost | Status |
|---|---|---|---|---|
| `vat` | `vat.vies_harden` | **VIES** (EU official endpoint) | free | LIVE (fallback validator) |
| `revenue` | `revenue.fatturatoitalia_by_vat` | **fatturatoitalia.it** by P.IVA | free | LIVE |
| `employees` | `employees.fatturatoitalia_by_vat` | fatturatoitalia.it (same fetch) | free | LIVE |
| `pec` | `pec.body` | firm's own page (free-gold) | free | LIVE (floor, ~5%) |
| `pec` | `pec.inipec_by_vat` | INI-PEC | — | DISABLED (access decision — below) |
| `email`/`decision_maker` paid tiers | finder/people APIs | — | paid | DISABLED |

Reuse, not rebuild: `vies.ts::checkVatViaVies` (was caller-gated, now wired),
`fatturato_italia_parser.ts::parseFatturatoItaliaPage` (pure, was waiting for a
fetcher — added `fatturato_italia_fetch.ts`). The per-field runner was made
**async** (`field_types.ts`/`run_field_cascade.ts`) so network steps can run;
tier-0 free steps stay synchronous. All toggleable via
`OFFICIAL_DATA_VIES_ENABLED` / `OFFICIAL_DATA_FATTURATOITALIA_ENABLED` (default on).

## Measured hit-rate (the honest numbers)

`pnpm exec tsx src/scripts/probe_official_data.ts --n 50` — read-only, €0, the
full pipeline (site → free-gold VAT → fatturatoitalia by VAT) on real seed
companies with a website:

| link | rate |
|---|---|
| site fetched | 49/50 |
| **VAT from site footer** (free-gold) | **77.6%** of fetched |
| fatturatoitalia page exists | 57.9% of VATs |
| **revenue resolved** | **57.9% of VATs · 44.9% of all website-having companies** |
| **employees resolved** | **50.0% of VATs** |
| cost | **€0** |

So: ~78% of website-having companies yield a VAT, and ~45% yield **real
revenue** from the official source — free. Not every Italian firm is on
fatturatoitalia (smaller/younger ones aren't), so 100% was never on the table;
45%-of-website-having at €0 is the honest, strong result.

**E2E in the browser** (`web/verify_e2e.mjs`): select 5 PD companies → `+ P.IVA`
(5/5 from site footers) → `+ Fatturato` → real revenues from fatturatoitalia.it,
live, €0. NOTE: the original screenshots showed the wrong-year values (€35.550 …)
— after the fix the same companies return their **2024** figures (Euganea
€51.619 etc.); re-capture the screenshot after re-running. Screenshots in
`docs/frontend_evidence/`.

## The footgun fix (shipped first)

The dev enrich was sequential (500 rows × 8s ≈ 67-min event-loop stall), with no
timeout and silent errors. Now: bounded concurrency (5 in flight), a 180s job
timeout, failed cells surfaced (no frozen spinner), the API rejects selections
> 200, and the client shows job/connection errors instead of hanging.

## PEC — the honest gap (decision for Marco)

The blueprint imagined "PEC ~100% via INI-PEC". The access reality:
- **Free floor (shipped):** PEC printed on the firm's own page (free-gold, ~5%).
- **INI-PEC bulk** (the near-100% source) is **not freely programmable**: the
  public portal (inipec.gov.it) is captcha-gated for manual lookup; bulk access
  is via licensed Registro Imprese / third-party APIs (**paid**), or a
  captcha-gated scrape (**ToS risk**).
- **Decision required:** (a) buy a PEC-by-VAT API (recurring cost), (b) accept
  the ToS/captcha risk of a portal scrape, or (c) live with the free floor. The
  `pec.inipec_by_vat` step stays `enabled:false` until Marco chooses. We do not
  silently scrape a captcha-walled government portal.

## GDPR posture (official-data)

`revenue`/`employees` are firmographic company data — low sensitivity. PEC is
borderline (a certified mailbox, often tied to the legal representative). For
**display** in the single-tenant dev dashboard this is fine; **outreach** to any
inferred email/PEC stays behind **Gate A** (LIA + Art.14 notice) per
`docs/gdpr/`. VIES + fatturatoitalia are official/public sources (no DPA needed
for VIES; fatturatoitalia is a public page) — add them to the sub-processor
note only if a paid PEC/registry API is later adopted.

## Verify
- `pnpm typecheck` + `pnpm test` (789 pass / 1 skip) + `pnpm run lint` — clean.
- New tests: async runner + throw-degrades; official-data step gating + the
  fetcher checksum gate (no network in unit tests).
- Hit-rate probe + e2e browser run as above.
- Paid tiers stay `enabled:false`; €0 spent.
