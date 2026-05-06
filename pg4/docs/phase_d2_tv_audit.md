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

## Acceptance status (after p62 re-run)

p62 will land here once the re-run completes:

- 441 / 441 expected
- cost 0 expected
- `Immobiliare Europa → europa.eu` MUST be rejected (regression test
  pinned)
- all p61 likely-TPs MUST stay (no logic change beyond the new
  denylist entry)
