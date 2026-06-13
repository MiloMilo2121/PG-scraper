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

## PHASE C — COVERAGE — BLOCKED ON OPERATOR DECISION (not executed)

Per ground-rule 6 (ask, don't assume) + C.1's explicit "ask before spending":
registry-as-universe needs a data source whose cost is an operator decision.
**Registro Imprese visure are PAID; there is no free official ATECO+province →
all-VATs feed.** So C cannot start without a decision on source + cost + the
ATECO/province slice. Surfaced as a costed question (see the session message /
DoD below), with a default proposal (real-estate 68.31 + PD) — NOT acted on.

When unblocked, C delivers: ATECO+province → official VATs → existing pipeline,
measuring coverage-lift vs PG/Maps and registry-lead precision (expected higher,
because the official VAT fixes the #1 gap: footer-unconfirmed VAT @0.6).

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
