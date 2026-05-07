# Phase F.1 — Manual audit of remaining PD suspects

**Goal:** before considering paid providers (Phase G), verify the 7
single-token brand-stem domains carried over from Phase F p82 audit
that had been marked as suspect but not yet manually verified.

**Method:** `WebFetch` against each domain on 2026-05-07 from the
working IP. Where redirected, follow once. Capture: page title,
company / legal name, business sector, locality.

**Output:** classification per case + smallest possible deterministic
guardrail that rejects the FP without sacrificing real TPs.

---

## Per-case findings

### 1. Franca Immobiliare (Albignasego) → franca.it

- 301 redirect to http://www.franca.it/
- Page identifies as: "Residence Franca"
- Sector: tourist accommodation (apartments + private rooms)
- City: **Arco (TN)**, Lago di Garda area
- Description: "casa per le vacanze, appartamenti turistici, camere
  private", "8 appartamenti e 6 camere private", "a cinque minuti
  dal centro storico" (Arco)

**Classification:** `FALSE_POSITIVE_GENERIC_HOMONYM`. Different city
(Arco TN vs Albignasego PD), different sector (tourism vs real
estate agency).

**Why pg4 accepted it:** distinctiveTokens = `['franca']`, length 1,
not in `COMMON_BARE_STEMS`. Layer B fires because `stem ===
compactStripped === 'franca'`.

**Surgical fix:** add `franca` to `COMMON_BARE_STEMS`. "Franca" is a
common Italian female name; the .it stem is genuinely generic.

---

### 2. Immobiliare Sartori (Casalserugo) → sartori.it

- Page title: Sartori Studio Legale
- Legal name: Sartori Studio Legale (law firm)
- Address: Via Grazioli, 75 - 38122 Trento, Italy
- Sector: legal services — banking, corporate, ESG, technology law
- Founder: Professor Filippo Sartori

**Classification:** `FALSE_POSITIVE_GENERIC_HOMONYM` /
`FALSE_POSITIVE_WRONG_SECTOR`. Different city (Trento vs
Casalserugo PD), different sector (law vs real estate).

**Surgical fix:** add `sartori` to `COMMON_BARE_STEMS`. "Sartori" is
an extremely common Italian surname.

---

### 3. Giemme S.r.l. (Albignasego) → giemme.com

- Curl returns: `<html><head><title>Loading...</title></head><body>
  <script>window.location.replace('https://giemme.com/?ch=1&js=...')
  </script></body></html>`
- Joken JWT-encoded redirect challenge — bot-detection / cloaking
- WebFetch sees only the loading page; cannot evaluate real content

**Classification:** `INCONCLUSIVE_NEEDS_PAID_OR_BROWSER`. The Joken
JWT bouncer is suspicious (legitimate Italian SMBs rarely deploy
this), but without browser execution we cannot confirm what the
real content is.

**Decision:** **NOT** added to `COMMON_BARE_STEMS`. Per the user's
"do not blindly reject without evidence" guideline. Documented as
followup #19 to revisit when paid evidence verification is on the
table.

---

### 4. Studio Immobiliare Colonna (Montegrotto Terme) → colonna.net

- Page content: Wittmann family personal website
- Owners: Dr. Dietmar H. Wittmann (retired US academic surgeon),
  Heide-Marie Wittmann (retired schoolteacher)
- Family relocated Hamburg → Wisconsin in 1988
- Children's bios (Mark — Florida cardiac anesthesia, Anna —
  University of Otago neurology in NZ)
- Categories: family history, travel, art, surgical research

**Classification:** `FALSE_POSITIVE_GENERIC_HOMONYM`. Personal
family website on the surname `colonna`, no Italian real-estate
connection at all.

**Surgical fix:** add `colonna` to `COMMON_BARE_STEMS`. Common
Italian surname AND a generic Italian noun (=`column`).

---

### 5. Immobiliare Chemello (Sandrigo VI) → chemello.it

- Page identifies as: "Chemello Metalworking Srl"
- Address: Via A. Meucci, 4 - 36066 Sandrigo (Vicenza)
- Phone: 0444 659663
- Sector: copper flower-holder production, funeral-art metalwork,
  TIG welding, laser cutting since the 1970s

**Classification:** `FALSE_POSITIVE_WRONG_SECTOR`. The most
interesting case in this batch: same surname AND same town
(Sandrigo VI), but a DIFFERENT legal entity in a different sector
(funeral-art metalwork, not real estate). Likely the same family
(common pattern in Italian SMB ecosystems), but pg4 cannot
determine the relationship at zero cost; the chemello.it site is
not the immobiliare's site.

**Surgical fix:** add `chemello` to `COMMON_BARE_STEMS`. Even though
this is a localised surname, the actual chemello.it owner is
verified to be the metalworking firm; any future "Chemello
Immobiliare" lead would not own this domain.

---

### 6. Immobiliare La Chiave S.r.l. (Padova) → lachiave.com

- **TRUE POSITIVE** ✓
- Page identifies as: "Immobiliare La Chiave"
- Address: Via Torino, 11 — Padova
- Phone: +39 049 652 860
- Sector: real estate agency
- Services: residential apartments + commercial spaces, sale +
  rental, valuations, social media presence

Same firm, same sector, same city as the lead.

**Action:** pin as TP regression test in
`tests/unit/preverify_gate.test.ts`.

---

### 7. Phosphoro S.r.l. (Padova) → phosphoro.com

- **TRUE POSITIVE** ✓
- Page title: "Affitti sicuri di stanze, appartamenti e case
  vacanza - Phosphoro"
- Sector: secure rental platform (rooms / apartments / holiday homes)
- Multiple `padova` mentions in the body
- Modern Next.js stack, Cloudflare in front

Same firm name, same city, real-estate-rental sector.

**Action:** pin as TP regression test.

---

## Summary

| domain | result | classification | surgical fix |
| --- | --- | --- | --- |
| franca.it | FP | FP_GENERIC_HOMONYM (Residence Franca, Arco TN) | + `franca` to denylist |
| sartori.it | FP | FP_GENERIC_HOMONYM / WRONG_SECTOR (Studio Legale Trento) | + `sartori` to denylist |
| giemme.com | INCONCLUSIVE | Joken JWT bouncer, no readable content | leave for followup #19 |
| colonna.net | FP | FP_GENERIC_HOMONYM (Wittmann family site) | + `colonna` to denylist |
| chemello.it | FP | FP_WRONG_SECTOR (Chemello Metalworking Sandrigo) | + `chemello` to denylist |
| lachiave.com | **TP** | Immobiliare La Chiave Padova | pin as TP regression |
| phosphoro.com | **TP** | Phosphoro rental platform Padova | pin as TP regression |

**4 confirmed FPs, 2 confirmed TPs, 1 inconclusive.**

## Code changes shipped in this commit

1. `semantic_evidence.ts` — `COMMON_BARE_STEMS` += {franca, sartori,
   colonna, chemello}. Each entry carries an inline comment with
   the audit reference.
2. `tests/unit/preverify_gate.test.ts` — 6 new pinned cases:
   - 4 FPs → REJECTED with reason matching `common_stem`
   - 2 TPs (lachiave, phosphoro) → VERIFIED_SEMANTIC

`giemme.com` is NOT added to the denylist. Documented as followup
#19 — revisit when browser-based evidence is available.

## p83 results

| run | found | direct_fetch_calls | direct_fetch_success_rate | ledger_summaries | cost EUR |
| --- | --- | --- | --- | --- | --- |
| p82 (Phase F) | 48 | 324 | 0.5789 | 1 ✓ | 0 |
| **p83 (Phase F.1)** | **47** | **323** | **0.4861** | **1 ✓** | **0** |

p83 vs p82 net delta: **−1** (48 → 47).
- **−9 lost**:
  - 4 audit FPs (Franca, Sartori, Colonna, Chemello) ✓ as designed
  - 5 network-flap dropouts (Colli Euganei, Happy House, Immobilsole,
    Obiettivo Casa, Pentacom — all confirmed plausible TPs from
    p82 that flapped this run; same family as BL p52 → p53 noise)
- **+8 gained**: pre-existing TPs that surfaced this run because the
  ranker now drops the 4 audit FPs at `drop` tier earlier:
  - Agenzia Immobiliare Euganea Case → euganeacase.com
  - Studio San Martino → studiosanmartino.it
  - Agenzia Immobiliare Kasa → agenziaimmobiliarekasa.it
  - Agenzia Immobiliare Artuso → agenziaartuso.com
  - Immobiliare Lara → immobiliarelara.it
  - Palladio Immobiliare → palladioimmobiliare.it
  - Roberta Soluzioni → robertasoluzioniimmobiliari.com
  - Trentin Immobiliare → trentinimmobiliare.it

### Cangrande / La Chiave / Phosphoro — pinned TPs all preserved

- **La Chiave**: p83 found a STRONGER URL —
  `immobiliarelachiave.net` (full-name compact) — instead of
  `lachiave.com` (bare-stem). The ranker correctly prefers the
  composite. Both are real-estate Padova; pin test still uses
  `lachiave.com`.
- **Phosphoro**: preserved on `phosphoro.com` ✓
- **Cangrande**: not in PD scrape; the VR-pinned regression test
  still guards the rule.

### Giemme — INCONCLUSIVE confirmed by URL drift

p82 had `giemme.com` (Joken JWT bouncer, no readable content).
p83 has `giemme.org` instead — same lead, different TLD candidate.
The fact that the candidate keeps shifting reinforces that this
case cannot be resolved at zero cost without browser execution.
Documented as followup #19.

## Direct_fetch breaker — honest disclosure

Final p83 ledger summary contains:

```json
{ "key": "direct_fetch",
  "state": "open",
  "consecutiveFailures": 5,
  "lastFailureKind": "transport" }
```

**The breaker is still OPEN at the end of p83.** Same state as p82.
This is consistent local network noise, NOT a one-off blip. The
`direct_fetch.success_rate` for p83 was 0.4861 (vs p82's 0.5789) —
the local fetch layer is genuinely flaky under the current IP /
network conditions.

**Operational implication for Phase G:** turning on paid Serper
without first stabilising local transport will conflate two
problems — paid-provider effectiveness and local-network noise. A
strict per-lead cost ceiling AND explicit breaker-state inspection
must be required before any paid-provider work.

This is followup #20 (network resilience) BEFORE followup #21
(paid Serper).

## Followups

19. **giemme.com — browser-rendered audit**: revisit with a real
    browser (or paid scraper) to determine the actual content
    behind the Joken JWT challenge.
20. **Confirm direct_fetch breaker behaviour** under quieter
    network windows; consider per-key-cooldown tuning if it stays
    open across runs.
21. **Then** Phase G: Serper at €0.001/call with strict per-lead
    ceiling.
