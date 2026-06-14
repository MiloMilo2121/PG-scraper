# Precision census — what to trust, what to fix, where to spend

*One file. Every field × every source-tier, with its FILL-RATE and its PRECISION
sampled against the source. No adjectives — sampled numbers. 2026-06-13, €0.*

Verdict legend: **SOLID** ship it · **FRAGILE** works but watch · **BROKEN**
don't trust yet · **NEUTRAL** wired-but-off (activation is a decision).
Tags: `[M]` MEASURED against source · `[I]` INFERRED from design/logic.

## The matrix

| field | source-tier | FILL-RATE | PRECISION (sample) | UI confidence | verdict | next action |
|---|---|---|---|---|---|---|
| **email** | website body (homepage) | 46.7% `[M n=60]` | ~100% same-domain `[M n=12]` | 0.80 `website_body` | **SOLID** | — |
| email | + contact/about pages (B.1) | +3.3pp → ~50% `[M n=60]` | 100% same-domain on lifted `[M]` | 0.80 `website_body` | **SOLID** (small lever) | keep; near free ceiling |
| email | pattern-guess `info@` | off | unverified (no MX/SMTP) `[I]` | — | **NEUTRAL** | needs a real verifier before on |
| email | finder API (paid) | off | — | — | **NEUTRAL** | DropContact/Hunter, operator decision |
| **VAT** | footer (own page) — VIES-confirmed | of footer: ~40% `[M n=18]` | **0.95**, name-matched `[M n=12]` | 0.95 `vies_confirmed` | **SOLID** | — |
| VAT | footer — unconfirmed (domestic) | of footer: ~60% `[M]` | probably-own, **VIES can't confirm domestic** `[M]` | 0.60 `footer_unconfirmed` | **FRAGILE** | registry (C) gives official VAT → fixes this |
| VAT | footer — proven foreign | — | refused (VIES names another co.) `[M]` | — (dropped) | **SOLID** (the precision win) | — |
| VAT | input `vat_code` | 44.8% of all rows `[M]` | VIES-gated before downstream `[M]` | inherited | **SOLID** (gated) | — |
| **revenue** | fatturatoitalia by VAT | 37.5% of reachable input-VAT `[M n=24]` · ~45% of website-having `[M]` | high when VAT-key right; official source `[M]` | 0.9/0.95/0.5 inherited from VAT | **SOLID** (ceilinged) | ceiling = bilancio-filers; not a bug |
| revenue | — reliability | — | **needs ~4s spacing or 0% at volume** `[M]` | — | **FRAGILE** (now throttled) | watch at volume; rate-limiter shipped |
| **employees** | fatturatoitalia by VAT | 25.0% of reachable input-VAT `[M n=24]` | bands parsed correctly `[M golden]` | inherited from VAT | **SOLID** (low fill) | many pages omit it even with revenue |
| **social** | website body | ~61% `[M n=23]` | 100% profile-shaped `[M]`; **ownership not auto-verified** `[I]` | 0.80 `website_body` | **FRAGILE** | ownership needs eyeball / no free check |
| **pec** | website body | ~5.3% `[M]` | high (certified-domain recognised) `[M]` | 0.85 `website_body` | **SOLID** (low fill) | — |
| pec | INI-PEC by VAT | off | — | — | **NEUTRAL** | paid API vs captcha — operator decision |
| **decision_maker** | body /chi-siamo | ~0% `[M]` | — | — | **BROKEN** (free) | honestly paid (people_finder, off) |

## The summary the operator asked for

### SOLID today (sellable now) — sampled, not claimed
1. **Email** ~50% fill, ~100% precision (same-domain enforced). The cleanest field.
2. **Revenue** from fatturatoitalia, ~37–45% fill, official source, high precision,
   confidence inherited from the VAT key. Free. (Reliability now throttled — see below.)
3. **VAT — the VIES-confirmed subset** (~40% of footer VATs) at 0.95, name-matched.
4. **Employees** ~25% fill, correct ranges (golden-locked), official source.
5. **PEC on-site** — low fill (~5%) but high precision where present.

### FRAGILE / needs work — the honest gaps
1. **VAT footer-unconfirmed (~60% of footer VATs @0.6)** — probably the company's,
   but VIES can't confirm domestic-only Italian VATs. Biggest precision gap.
2. **Revenue/employees reliability** — fatturatoitalia silently returns 0 at volume
   without ~4s spacing (MEASURED: 0% burst vs 5/5 throttled). Rate-limiter shipped;
   watch at scale (a large selection is now slow-but-true, not fast-but-empty).
3. **Social ownership** — links are profile-shaped (100%) but we can't auto-prove the
   profile belongs to the firm (could be a partner's). Fill is fine; trust needs an eye.

### BROKEN / off (don't trust / not active)
- decision_maker free tier (~0%); pattern-guess email (no verifier); paid tiers +
  INI-PEC (off by decision).

### The single highest-leverage next fix
**Phase C — registry-as-universe (Registro Imprese: ATECO + province → official VATs).**
It is the only move that fixes the #1 precision gap (it returns the OFFICIAL VAT,
eliminating the ~60% footer-unconfirmed problem at the root) AND raises coverage AND
keys revenue/employees at high confidence — three wins from one source. Gated on the
visure data cost (operator decision — see quality_pass_b_c_report.md).

> Status (2026-06-14): the FREE path to this was attempted and proven a dead-end
> (`docs/coverage_registry_recon.md`); operator chose to accept the current PG+Maps
> discovery for now. This remains the highest-leverage fix the day a paid source
> (Registro Imprese / company-data API) is approved — it's a ~1-adapter build
> against the ready `RegistryUniverseSource` spec.
>
> Scraping pass (2026-06-14, `docs/scraping_pass_report.md`): a FREE third-party
> cross-reference to lift the VAT footer-unconfirmed 60%@0.6 was MEASURED to add
> **0 confirmations beyond VIES** (n=15) — fatturatoitalia is filer-only and
> overlaps VIES; the gap-covering sources (ufficiocamerale, infoimprese) gate their
> search behind reCAPTCHA. So VAT footer-unconfirmed STAYS @0.6 on the free path;
> gap #1 closes only via the paid official API (Openapi free-tier slice ready) or
> captcha-solving (rejected). The structural ceilings below are unchanged by scraping.

## Structural ceilings (not bugs — don't chase them with free tools)
- **Email free fill ~50%**: the rest publish no same-domain email (gmail / form / none).
- **Revenue/employees ~37–45%**: only capital companies (SRL/SpA/coop) file public
  bilanci; ditte individuali / sole proprietors have NO free financials anywhere.
- **VAT domestic confirmation**: VIES covers only intra-EU-registered VATs (~40%);
  full domestic confirmation needs Registro Imprese (paid), not a free source.
