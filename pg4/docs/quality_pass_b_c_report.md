# Quality pass B → C — fill-rate, then coverage (gated)

*2026-06-13. Continues Phase A. FILL-RATE (populated) and PRECISION (correct)
reported separately. Every gain sampled against the source before it counts. €0.*

## Headline (honest)
Phase B raised the free fill levers AND, more importantly, found two real things
by sampling against the source — neither would a green test have caught:
1. **The rate-limit footgun**: fatturatoitalia.it silently returns 0 (status-0,
   empty body) under burst requests — a no-delay probe of 30 VATs returned 0%
   while the SAME VATs fetched 5/5 with ~4s spacing. The dev server's
   concurrency-5-no-delay path would have silently 0-filled revenue/employees at
   volume. FIXED (module rate-limiter, ~4s). This is the 4th source-check catch.
2. **The structural ceiling**: revenue/employees free fill is capped at the
   bilancio-filing share (~37–45%) — the rest are ditte individuali with NO free
   financials anywhere. Not a bug; the Italian disclosure regime. The 5th catch:
   the earlier "0%" conflated "blocked" with "no data" — now classified apart.

The free fill levers are near their structural ceilings; the real Phase-B risk
was reliability, now fixed. The big remaining lever is Phase C (registry).

---

## PHASE B — FILL-RATE (gate PASSED)

### B.1 — Deepen the FREE tiers (`deep_pages.ts`) — €0
ADDS `deepExtractFromSite`: fetch the homepage AND a bounded set of its own
contact/about links (discovered on the homepage, same-site only), run the SAME
pure `extractFromBody` on each, merge (fill-first scalars, union arrays). One
deepened pass feeds email + social + VAT. REUSES `extractFromBody` (purity
intact), `DirectFetchProvider`. Wired into the dev server's enrich path.
- **email**: fill 46.7% → **50.0%** (+3.3pp) `[M n=60]`; the lifted emails are
  **100% same-domain** — precision preserved, never traded for fill.
- Small lever (the footer is global, so most emails are already on the homepage);
  free email fill is near its ~50% ceiling. Pattern-guess `info@` tier is wired
  but DISABLED — with dns_mx removed, an unverified guess is the precision risk
  Phase A fought; activate only with a real verifier, tagged as its own tier.

### B.2 — VAT-as-master-key multiplier + confidence inheritance
- **Measured** (`probe_vat_multiplier.ts`, classified blocked/no-data/has-data):
  1 reachable VAT key → **37.5% revenue + 25.0% employees**, free `[M n=24]`.
- **Confidence inheritance** (ADDS): a firmographic is only as trustworthy as the
  VAT that fetched it, so revenue/employees confidence is now capped by the key's
  trust — own-page VAT 0.9 · VIES-confirmed input 0.95 · VIES-down input 0.5 —
  and the source carries the tag (`fatturatoitalia(site|input+vies|input?vies-down)`).
- **Reliability fix** (the footgun): module rate-limiter at ~1 req/4s on the
  fatturatoitalia fetch, so the server pool + probes self-throttle. REUSES
  `RateLimiter`. Trade-off stated: large selections are slow-but-true.

### B.3 — Paid tiers wired-but-DISABLED (verified, €0)
`email.finder_api` (DropContact/Hunter slot, tier-2) = off; `decision_maker.
people_finder` (Proxycurl slot, tier-2) = off; `pec.inipec_by_vat` = off;
`email.pattern_guess` = off. No paid leak (asserted). Activation = operator
decision + provider adapter + flip enabled. INI-PEC stays operator decision
(paid API vs ToS-risky captcha — never scrape the government captcha).

### PHASE B GATE — evidence
- [x] email raised (+3.3pp) WITH source-sampled precision (100% same-domain)
- [x] revenue/employees multiplier measured (37.5%/25%) + classified honestly
- [x] low-confidence tier (pattern-guess) tagged + kept off, never merged
- [x] VAT-key downstream lift measured; confidence inheritance shipped + surfaced
- [x] paid tiers wired-disabled; €0 spent + reported
- [x] real-data goldens for the new extractor (deep_pages, 6 tests); 806 green
- [x] reliability footgun found by source-check + fixed (rate-limiter)

---

## PHASE C — COVERAGE — free-scrape attempted, operator chose to accept current discovery

Operator decision 1: "attempt a free directory scrape." DONE, thoroughly — and
reported as a dead-end rather than forced (see `docs/coverage_registry_recon.md`):
ufficiocamerale/reportaziende are Cloudflare-blocked; companyreports renders via
Playwright but serves only top-50-by-revenue per province (no sector filter,
rate-limits hard, capital-companies only); aziende.virgilio is redundant
PagineGialle data with no listing VATs; and ditte individuali appear in NO
directory (no bilancio) — so a free census is structurally impossible.

Operator decision 2 (now informed): **accept the existing PG+Maps discovery as
the coverage method (€0)**. It already answers "companies of type X in area Y" for
the portal-listed majority, paired with the Phase-A VAT precision. No new build,
no spend. A true legal census (incl. ditte individuali) needs paid Registro
Imprese / a company-data API — left as a ready-to-plug `RegistryUniverseSource`
spec (recon doc) for when spending is approved; that path is a ~1-adapter build.

Net: Phase C closes WITHOUT a registry build, by an informed operator choice, with
the free path proven infeasible and the paid path specced. Honest over forced.

---

## €-SPEND: €0 (VIES + fatturatoitalia + HTTP free; all paid `enabled:false`).

## WHAT'S LEFT IN NEUTRAL + activation
- **Pattern-guess email**: needs a real verifier (SMTP/finder) → then on, tagged.
- **Paid finder/people_finder** (DropContact/Proxycurl): flip enabled + adapter,
  bounded sample under the €0.02 ceiling — operator decision, default off.
- **INI-PEC bulk PEC**: paid API vs captcha — operator decision.
- **Registry (Phase C)**: paid visure — operator decision on source + cost + slice.

## NOT PUSHED — owner holds push behind external verification (10-row check).
See `docs/precision_census.md` for the full field×source trust map.
