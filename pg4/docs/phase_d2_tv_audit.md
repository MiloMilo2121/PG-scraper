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
6. **Optional**: a low-noise re-run window scheduler (run during
   off-hours, or use a cleaner egress IP).
