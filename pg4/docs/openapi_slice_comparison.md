# Openapi free-tier slice — execution-ready (pending one operator action)

*The council's recommended step: a €0 free-scrape-vs-Openapi-free-tier comparison
on ONE ATECO+province. This doc is the ready-to-run spec + the safety review.
2026-06-14. Spent: €0. Not run yet — the only blocker is a free Openapi API key
(operator signup, no card for the free tier). Honest status: HANDOFF, not RUN.*

## Why this isn't already run (honest)
The slice needs an Openapi API key. There is none in `.env` (checked, no value).
The free tier (IT-search ≤100/day, 30 IT-pec/month) needs a signup. I will NOT:
- fabricate numbers, or
- ship an HTTP adapter coded from an API shape I couldn't fully fetch and can't
  call — that would be a golden built from an UNVERIFIED shape, the exact
  anti-pattern that caused this project's 5 bugs ("sample against the source").
So this is the precise execution handoff the council + the budget rule call for.

## Verified API facts (against the source, WebSearch/WebFetch 2026-06-14)
- **IT-search** — `GET https://company.openapi.com/IT-search`. Lists Italian
  companies by 15+ combinable params incl. **ATECO, province, REA, turnover,
  employees, status**. **Free ≤100 requests/day with `dry_run`** (dry_run returns
  COUNTS — segment sizing at €0); **€0.01/req** beyond the free limit. ✅ confirmed.
- **Per-endpoint pricing model** — `/IT-pec`, `/IT-advanced`, `/IT-marketing`,
  `/IT-stakeholders`, `/IT-aml`, `/IT-shareholders` … "pay only for what you need."
  IT-pec ≈ €0.03 (30 free/mo per the brief), IT-advanced ≈ €0.10 (REA, legal form,
  ATECO, revenue, employees, **legal representative**). ✅ model confirmed; exact
  per-call prices to confirm in-console at signup.
- **Visure Camerali** — €2.90+ each (the heavyweight option; NOT needed for the slice).
- Auth: Bearer token / API key (standard). Endpoints under `company.openapi.com`.

## ⚠️ The flip-condition the council caught — UNRESOLVED, operator gate
**Can a SaaS REDISTRIBUTE Openapi data to its own paying customers?** The ToS are
in downloadable PDFs (not inline) — I could not extract the redistribution clause.
- Positive signal: Openapi explicitly markets the Imprese API for "database
  enrichment / marketing / AML" — i.e. commercial customer-side reuse is the
  intended use case.
- BUT downstream REDISTRIBUTION inside a third-party SaaS is a distinct right.
- **GATE: before any "official-provenance moat" claim to enterprise buyers, read
  `openapi.com/terms-conditions` (the PDF) / confirm with Openapi sales that SaaS
  redistribution is licensed.** If it is NOT, Path A's moat collapses toward C's
  legal exposure (per the council) — pivot to a properly-licensed CCIAA/Registro
  Imprese feed. This is the #1 thing to verify, ahead of any spend.

## The slice — what to run (€0), field-by-field
Scope: **real-estate ATECO 68.31 + province PD** (already validated in pg4).
1. `IT-search?dry_run` (free) → COUNT of 68.31 companies in PD = the legal-universe
   size. Compare to how many PG+Maps discovery currently finds → **coverage gap**.
2. `IT-search` (free ≤100) → pull ~50-100 companies (name + official VAT + ATECO).
3. For those, compare CURRENT free-scrape vs Openapi free-tier, **per field, fill
   AND precision SEPARATELY** (the project's non-negotiable distinction):
   | field | free-scrape today | Openapi free-tier | what to measure |
   |---|---|---|---|
   | VAT | footer-scraped, ~40% confirmed @0.95 / ~60% @0.6 | official | confidence lift (0.6→official) |
   | PEC | ~5% on-site | IT-pec (30 free) | fill lift |
   | decision-maker | ~0% free | IT-advanced legal rep* | fill (0→?) |
   | revenue/employees | ~37-45% / ~25% | IT-advanced* | fill + agreement on overlap |
   *IT-advanced is €0.10 — for the FREE slice, sample only a handful (≤ a few €0.0x,
   operator-approved) OR defer IT-advanced to the paid go/no-go; IT-search + IT-pec
   are the €0 core. Every Openapi value is checked against the company's own page on
   the overlap set (sample-against-source) before any "precision" is claimed.
4. Output: a fill+precision delta table → the go/no-go for IT-advanced at scale,
   decided on the owner's real per-field numbers, not on principle.

## Integration-risk-review — the Openapi adapter (applying the skill's checklist)
Pre-implementation risk gate for wiring Openapi as a paid provider behind the
existing free-first waterfall (`field_registry` cascades, `env.ts` provider pattern).

1. **External side effects** — OK. Read-only GETs; no writes/sends. Reversible (no mutation).
2. **Data leakage** — MITIGATION: company data is business data (not consumer PII),
   but the VAT/name sent to Openapi must not include any internal annotations; log
   the VAT queried, never the API key. PEC/legal-rep are personal-data-adjacent →
   keep behind the same GDPR posture as existing enrichment (display-ok, outreach
   gated). Owner: implementer.
3. **Rate limits** — MITIGATION: IT-search 100/day free; bound the slice ≤100 and
   add the same self-throttle pattern proven for fatturatoitalia (the rate-limit
   footgun lesson) — a token-bucket on the Openapi client. Backoff on 429. Owner: implementer.
4. **Auth / credentials** — MITIGATION: `OPENAPI_API_KEY` as env placeholder,
   never committed; `OPENAPI_ENABLED` default false (triple-gate: enabled + key +
   per-field ceiling). Follows the exact SERPER/EXA/HUNTER pattern in `env.ts:30-57`.
5. **Idempotency** — OK. GET-by-VAT is naturally idempotent; memoise per VAT (the
   fatturatoitalia memo pattern) to avoid paying twice for one company in a session.
6. **Retries** — MITIGATION: bounded retry (2) with backoff; a failed lookup → cell
   `not_found` / low-confidence, never a silent hang (the api_server footgun lesson).
7. **Human approval gates** — OK + REQUIRED: any PAID call (IT-advanced €0.10,
   IT-search beyond free) stays `enabled:false` until operator flips it; the proven
   €0.02/field ceiling gates per-field spend. No autonomous paid calls.
8. **Webhook security** — N/A (no webhooks; pull-only).
9. **Compliance** — MITIGATION (the BLOCKER-until-verified): the redistribution
   license gate above. Plus: official-source provenance tag per cell
   (`source: 'openapi:IT-advanced'`, year-tagged) so precision/freshness are visible.
10. **Rollback** — OK. Disable = flip `OPENAPI_ENABLED=false`; the free-first
    cascade falls back to the current free tiers. Clean, no data migration.

**Verdict: APPROVED WITH MITIGATIONS** — buildable behind the existing triple-gate,
with ONE BLOCKER for the *moat claim* (not the build): verify SaaS-redistribution
license before selling the data as "official-provenance." Building + measuring the
free slice carries no such block.

## The keyed run (the handoff — ~1 session once a free key exists)
1. Operator: create a free Openapi account → get the API key (no card for free tier).
2. Add `OPENAPI_ENABLED` / `OPENAPI_API_KEY` to `env.ts` (4 lines, SERPER pattern).
3. Capture ONE real IT-search + IT-pec response → finalize the parser + write its
   real-data golden FROM that captured response (not from docs).
4. Wire `openapi.ts` as a tier-1/2 step in the pec / revenue / employees /
   decision-maker / vat-confirmation cascades, `enabled:false` + ceiling-gated.
5. Run the slice (68.31 + PD, ≤100 companies, IT-search+IT-pec free) → emit the
   fill+precision delta table here. €0.
6. Decide IT-advanced (€0.10) on the measured uplift + a real client-price check.
