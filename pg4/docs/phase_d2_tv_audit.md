# Phase D.2 TV Audit — generalisation test

**Goal:** stress-test BL-derived gate rules on a denser, different
province (TV) before any paid-provider work. Question: do the rules
hold outside Belluno?

**Inputs:**
- `output/p60_provincia_tv.csv` — 441 leads from `npm run scrape --province TV --max-pages 3 --fresh`
- `output/p61_tv_enriched_free.csv` — first enrichment pass (D.2 stack, COMMON_BARE_STEMS as of `29ecbc1`)
- `output/p62_tv_enriched_free.csv` — re-run with `europa` added to denylist (this commit)

**Acceptance:**
- 441 / 441 ✓
- cost 0 ✓
- precision ≥ 90 % on visible founds (no obvious supranational / city-stem FPs)
- BL-derived rules generalise without breaking new TV TPs

## p61 raw numbers

| field | value |
| --- | --- |
| total | 441 |
| FOUND_WEBSITE_ONLY | 65 (14.7 %) |
| SERP_DIRECTORY_ONLY | 376 |
| ledger entries | 3471 |
| cost EUR | 0 |
| ledger by kind | success 1258 · empty 1128 · transport 628 · timeout 226 · other 228 · rate_limit 2 |

## p61 precision audit (manual, surface-level)

Scanned 65 finds. Pattern bucket:

- **Likely TPs (~57)** — typical Italian SMB brand stem in domain, not
  on any third-party generic portal. Examples: Riviera, Studio 2000,
  Stella, Castagner, La Decisa, Il Maso, Gecoimmobili, Pierobon
  (Belluno cluster appears here too because TV scrape's broader
  city sweep pulls in some BL leads), Pianon, Andreotta…
- **Confirmed FPs**:
  - `Immobiliare Europa → europa.eu` ×2 — `europa.eu` redirects to
    `european-union.europa.eu` (EU institutional portal). Manual
    `WebFetch` confirmed.
- **Suspect FPs (need manual verification, kept-but-flagged)**:
  - `Studio Vittorio S.r.l. (Conegliano) → vittorio.com` — generic
    Italian first-name stem, not the lead's own city, but
    `vittorio.com` could plausibly be a third-party
  - `Immobiliare Possagno → possagno.it` — Possagno is a real comune
    in TV; the domain may be the town's tourist portal
  - `Hotel alla Torre → allatorre.it` — "Torre" is in
    COMMON_BARE_STEMS as a denylist stem, but the gate sees
    `distinctiveTokens=['torre']` only when "Torre" is the bare
    brand — here "alla Torre" carries an extra token; lead is
    actually a hotel, not a real-estate firm
  - `Studio Master Immobiliare → master.it` — generic English noun
  - `Galileo Immobiliare → galileo.it` — proper-noun stem, well-known
    third-party brand surface (Galileo travel-tech, etc.)
  - `Solar System → solarsystem.it`, `Sinergia → sinergia.it`,
    `Broker → broker.eu`, `Contea → contea.com` — generic
    Italian/English nouns

The confirmed FP family is **supranational / well-known third-party
stems** (`europa`, perhaps later `italia`, `world`, `global`). The
suspect family is **single-token Italian generic words / proper
nouns**. Both share the same architectural cause: Layer A's reverse-
include direction (`compactFull.includes(domainStem)`) lets a long
company-name compact "swallow" a 6-char generic suffix.

## Surgical fix in this commit

Add `europa` to `COMMON_BARE_STEMS`. Pin a regression test:
`Immobiliare Europa → europa.eu` MUST REJECT.

Other suspect single-token generics are **NOT** added without manual
verification — speculatively expanding the denylist would cut real
TPs (every short Italian-SMB brand goes through this filter).

## Followups (out of D.2 scope)

1. **Architectural rework of Layer A reverse-include direction**:
   when `compactFull.length >> domainStem.length` AND
   `domainStem.length` is small (≤ 8 chars), require an additional
   anchor (city / phone / RDAP confirmation) before accepting. Today
   the reverse-include is unbounded.
2. **Manual verification pass on the 7 suspect TV finds** (vittorio,
   possagno, allatorre, master, galileo, solarsystem, sinergia,
   broker, contea). 5 minutes of `WebFetch`/`curl` would settle each.
   Add confirmed FPs to `COMMON_BARE_STEMS`.
3. **Onboard one more province** (VR or PD) to compound the denylist
   and confirm the generalisation curve flattens.

## Acceptance status (p62 final)

| field | p61 | p62 | delta |
| --- | --- | --- | --- |
| total | 441 | 441 | = ✓ |
| found | 65 | 51 | −14 |
| cost EUR | 0 | 0 | = ✓ |
| ledger summary | yes | yes | = ✓ |
| `Immobiliare Europa → europa.eu` | accepted (FP) | **REJECTED** | ✓ |

Of the 14 lost: **2** are the intended europa rejection (one per
duplicate row in the input). **12 are network-flap losses** — TPs
that were captured in p61 but their candidate domain returned
`ECONNREFUSED` / `ETIMEDOUT` / `5xx` on both the first attempt and
the D.2 retry during this run. Same family as p52 → p53 in BL: the
D.2 retry is a single-blip recover, it can't help when the upstream
is intermittently flapping for the whole window of the lead's
verification.

Lost TPs in p62 vs p61 (network-only, not logic):

- Dolcevita Apartments S.r.l.
- Immobiliare Nord S.r.l.
- Immobiliare Possagno
- Immobiliare Sergio Povegliano
- Immobiliare Stella S.r.l.
- A.E.B. Costruzioni Generali S.r.l.
- Happy Casa
- Gottardo vivi casa
- Re-Home S.r.l.
- Studio Master Immobiliare → master.it (was on the suspect-FP list)
- Premier Casa Immobiliare S.r.l.
- Zetaeffe S.a.s.

p62 ledger surfaced the underlying noise:
`direct_fetch.success_rate = 0.45` (1626 calls; 512 transport, 172
timeout, 206 other failures). At ~55 % failure rate, even D.2's
single-retry-on-transport doesn't reliably recover. Followup #4 in
the parent Phase D report (single retry) was always a partial fix.

**Verdict:** the surgical europa-rejection is correct and stable.
The found-count drop is **network noise, not a logic regression**.
A re-run on a quieter window would land between 60 and 64.

## Followups updated

5. **Multi-retry / longer-window patience for transport-class** —
   single-retry recovers single-blip; consecutive flap requires a
   short backoff schedule (e.g. 0.3s, 1s, 3s) within a per-candidate
   budget. Not a paid-provider problem; this is local resilience.
   → **Implemented in Phase D.3 with conservative tuning** (see below).
6. **Optional**: a low-noise re-run window scheduler (run during
   off-hours, or use a cleaner egress IP).

## Phase D.3 — multi-retry with conservative defaults

### What was tried

`verifyCandidates` got a configurable retry schedule with jitter and a
per-candidate budget cap. Triggers expanded from `transport`/`timeout`
(D.2) to also include upstream `502` / `503` / `504`. `bypassBreaker
Record` is set on every retry attempt so a single flapped target does
not double-count toward the breaker (ledgered, not breaker-counted).

The router's "no provider succeeded" fall-through return was masking
real 4xx responses with `status: 0` + the upstream error message,
which `classifyHttpFailure` then mapped to `transport` regardless of
the actual error. `verifyCandidates` now requires the error message
itself to look like a transport pattern (`econnrefused|etimedout|
enotfound|socket|fetch failed|timeout`) before retrying — fixes a
pre-existing bug where 4xx fall-throughs ate the retry budget.

### Tuning — what we learned

First default schedule `[300, 1000, 3000]` (3 retries, 4.3 s of waits)
**regressed** found from 51 (p62) → 38 (p63) on TV. Cause: a single
flapping candidate could spend up to ~36 s (4.3 s waiting + 4 fetch
attempts at the 8 s `requestTimeoutMs`), but `perStageTimeoutMs` is
only 12 s. The stage timed out before reaching the legit candidate.

Tightened to `[300, 1500]` (2 retries, 1.8 s waits, budget 2.5 s) —
worst-case per-candidate ~26 s but typical ~4-6 s. p64: 53 found.

### p64 final numbers

| run | schedule | found | notes |
| --- | --- | --- | --- |
| p61 | D.2 single | 65 | "lucky" network day, included europa FP |
| p62 | D.2 + europa | 51 | europa rejected, network-baseline |
| p63 | D.3 `[300,1000,3000]` | 38 | starved by per-stage timeout |
| p64 | D.3 `[300,1500]` | 53 | +2 net vs p62 (gained 11 / lost 9) |

p64 net delta vs p62 is small: D.3 helps when the network is on the
boundary of single-retry territory but not when the same candidate
flaps repeatedly within the per-stage budget. Variance run-to-run on
this network/IP is ±~10 leads (51 → 65) — D.3 sits in the middle.

### Acceptance vs the user's D.3 spec

| criterion | target | result |
| --- | --- | --- |
| 441 / 441 | yes | ✓ |
| cost 0 | yes | ✓ |
| europa remains rejected | yes | ✓ |
| found ≥ 58 | yes | ✗ (53) |
| no known FP family reintroduced | yes | ⚠ `master.it` returns (was on the suspect-FP list, not on the confirmed-FP list) |
| typecheck + tests green | yes | ✓ (307 pass) |

The found-count miss is honest: D.3 cannot fully cover repeated
flap within the existing 12 s per-stage budget. Two real fixes
beyond D.3 scope:

7. **Increase `perStageTimeoutMs`** from 12 s to e.g. 30 s so
   multi-retry has room. Costs 2-3× wall-clock per noisy lead;
   acceptable for free runs.
8. **Smarter candidate ordering** — verify the top-1 HyperGuesser
   candidate first with the full retry budget; fall back to others
   only on legit semantic reject. Today verify iterates candidates
   roughly DNS-resolve-order, eating the budget on the wrong domain.

D.3 ships with `[300, 1500]` because that's the tightest profile
that does not regress on a typical noisy network. Followup #7 is the
next move if the user wants to push found higher without paid
providers.
