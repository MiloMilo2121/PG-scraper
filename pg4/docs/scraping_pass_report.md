# Scraping pass — third-party Italian company-data sources, with anti-bug discipline

*Owner chose scraping over the paid API (no budget). Done WELL = with every guardrail
the 5 bugs taught. The honest result: the free scraping path is exhausted for the
gap that matters, and the discipline (sample-before-build) proved it at €0 instead of
shipping fragile scrapers. 2026-06-14. No code changed (nothing was worth building);
806 tests green; nothing pushed.*

## Headline
A full survey + a measured cross-reference attempt confirm: **no free, captcha-free,
Registro-complete, programmatically-searchable source exists.** The Italian
company-data web has a consistent structure —
- **Registro-complete sources** (ufficiocamerale, infoimprese — the official CCIAA
  directory) gate their SEARCH behind **reCAPTCHA** (they monetize the data);
- **non-gated sources** (fatturatoitalia) are **filer-only** and redundant with VIES.
So the free path cannot close the FRAGILE VAT gap (#1) or the structural ceiling.
This is market structure, not a pg4 failure — and it loops straight back to the
council's verdict: gap #1 closes only via the official paid API or captcha-solving
(both already rejected — budget / provenance).

## Phase A — source × field survey (probed TODAY, live)
| source | access | covers ditte individuali? | key fields | lookup | safe rate | verdict |
|---|---|---|---|---|---|---|
| **fatturatoitalia.it** | ✅ DirectFetch | ❌ filers only | fatturato, dipendenti, name | **by VAT (URL)** ✅ | ~1/4s (MEASURED; bursts → status-0) | **USABLE, already wired**; filer-only; no PEC on page (paywalled) |
| **ufficiocamerale.it** | ✅ via Playwright (Cloudflare passes); ❌ DirectFetch | ✅ Registro-complete | P.IVA, REA, PEC*, fatturato, dipendenti, name, address | **search reCAPTCHA-gated** ❌ | n/a (can't search) | **BLOCKED for lookup** — per-company pages reachable only if you already know the internal-id URL; *PEC behind "ACQUISTA VISURA" paywall |
| **infoimprese.it** (official CCIAA) | ✅ loads | ✅ Registro-complete | official registry data | **reCAPTCHA on search** ❌ | n/a | **BLOCKED for lookup** |
| **reportaziende.it** | ❌ "Accesso bloccato" | — | — | — | — | **BLOCKED** |
| **companyreports.it** | ⚠️ Playwright only | ❌ filers (top-by-revenue) | name, VAT (URL slug) | province=top-50 cross-sector; sector filter times out | rate-limits hard after a few req | **marginal** — not a sector census |
| **aziende.virgilio.it** | ✅ DirectFetch | partial (portal-listed) | name, address | category+province | — | **redundant** — PagineGialle data pg4 already discovers; no VATs in listings |
| **guidamonaci.it** | ✅ loads | B2B directory | name | — | — | no VATs on surface; not Registro-complete |

\* PEC exists on the ufficiocamerale page label but the value is paywalled (visura).

## Phase B — per-field scraped extractors: NONE built (and why that's correct)
The only non-captcha, URL-addressable source is **fatturatoitalia, already wired**
(revenue/employees for filers, rate-limited at 4s — the bug-#4 footgun fix). Every
OTHER source is captcha-gated (ufficiocamerale/infoimprese), anti-bot-blocked
(reportaziende), a rate-limited showcase (companyreports), or redundant (virgilio).
Building a new extractor against any of them means either solving captchas (rejected)
or a fragile Playwright scraper that rate-limits hard for marginal/redundant data.
Per the discipline (don't ship fragile/redundant scrapers; sample before build),
**no new extractor was worth building.** Checked for a free PEC win on fatturatoitalia
— the page shows the PEC *label* but the address is paywalled. No win.

## Phase C — gap #1 free cross-reference: ATTEMPTED, MEASURED to add 0
Full evidence: `docs/precision_evidence/vat_crossref_probe.md`. Sampled 15 real
companies: fatturatoitalia name-match adds **0 confirmations beyond VIES** (filer
overlap; the gap = non-filers with no fatturatoitalia page). The gap-covering sources
are reCAPTCHA-gated. So the free cross-reference cannot lift VAT precision. NOT built
(a redundant 0-lift tier with maintenance cost is the anti-pattern). VAT stays
~40% VIES-confirmed @0.95 / ~60% footer-unconfirmed @0.6.

## Hard truths restated (reality, not bugs)
- **Structural ceiling holds**: ditte individuali file no financials → fatturato/
  dipendenti capped ~37-45% from ANY source (these sites pull from the same Registro).
  Scraping more sources does NOT unlock data that doesn't exist.
- **"99% good data on the site" ≠ "99% correct extraction"** — and this pass added
  a corollary: even a perfect extractor can't extract from a page that's captcha-
  gated or filer-blind. The wall moved from parsing to ACCESS.

## Provenance / ToS note (operator decision — do not let it slip)
fatturatoitalia, ufficiocamerale, companyreports are **third-party commercial sites**;
their ToS almost certainly restrict automated scraping. For **personal/test
enrichment** that's one risk posture; if scraped third-party data becomes the data
base of a **sold SaaS**, the same enterprise due-diligence that killed 2Captcha would
scrutinize this too. KEEP THE DISTINCTION EXPLICIT: "I use it to enrich" vs "I resell
it." This report does NOT treat scraped third-party data as clean official data.

## Anti-bug guardrails — status this pass
- Rate-limit before volume: fatturatoitalia limiter (4s) in place (bug #4). No new
  source reached volume (none viable), so no new limiter needed yet — but the rule
  stands for any future source.
- Real-data goldens / anchor-on-labels / loud-failure: no new extractor shipped, so
  no new golden; the existing fatturato/dipendenti goldens (real edge cases) hold.
- Sample-against-source: applied — and it's what produced this report's core finding
  (cross-ref 0-lift) instead of a shipped redundant tier.

## What's measured vs assumed
- MEASURED: every source's live access + captcha/block status (today); the cross-ref
  0-lift (n=15); fatturatoitalia filer-blindness (Marengo generic page).
- ASSUMED: exact ToS clauses (not read in full — flagged as operator gate); whether a
  search-engine-assisted lookup (Google "ufficiocamerale <vat>") could reach gated
  pages (possible but fragile + its own ToS issue — not pursued).

## Bottom line / next move
The free scraping path is genuinely exhausted for gap #1 and the ceiling. The honest
options remain the council's: (A) official paid API (Openapi — the €0 free-tier slice
is specced and ready, `docs/openapi_slice_comparison.md`), or accept the current state
(VAT 40%@0.95 + 60%@0.6, revenue/employees ~37-45%) as the free ceiling. Captcha-
solving the Registro-complete sources is the same rejected provenance trade as 2Captcha.
Recommended: when budget allows, run the €0 Openapi free-tier slice — it's the only
path that reaches the non-filer gap legitimately.
