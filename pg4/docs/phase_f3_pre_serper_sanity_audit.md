# Phase F.3 — Pre-Serper sanity audit (academy.it + giemme.org)

**Goal:** before turning on paid Serper (Phase G), audit the last
two suspect single-token domains in p84 to make sure pg4 isn't
shipping any obvious FPs into the paid-provider benchmark.

**Method:** `WebFetch` against each domain on 2026-05-07 from the
working IP. Where redirected, follow once. Capture: page title,
company / legal name, business sector, locality.

---

## Per-case findings

### 1. Academy S.r.l. (Rovigo) → academy.it

- 301 redirect to `new.academy.it`
- Page identifies as: "The British Academy"
- Sector: English-language education / Cambridge English certification
- Cities: Cassino (FR) — Piazza Alcide De Gasperi 16; Sora (FR) —
  Via Marcello Lucarelli 1
- Region: Lazio
- Programs: children/teen English courses, adult programs, Cambridge
  certification, study trips to Oxford / London / Edinburgh / Dublin

**Classification:** `FALSE_POSITIVE_GENERIC_HOMONYM`. Different
region (Lazio FR vs Rovigo RO), different sector (education vs
real estate). "Academy" is a generic English noun.

**Why pg4 accepted it:** distinctiveTokens = `['academy']`, length 1,
not in `COMMON_BARE_STEMS`. Layer B fires because `stem ===
compactStripped === 'academy'`.

**Surgical fix:** add `academy` to `COMMON_BARE_STEMS`.

---

### 2. Giemme S.r.l. (Albignasego PD) → giemme.org

- Page identifies as: "Gi. Emme Macchine Utensili"
- Sector: industrial machine tools — sales, representation, commerce
- Founded: 1997
- Location: Albignasego (PD) — **same town as the lead**
- Showroom: 1000 m² with new + used equipment

**Classification:** `FALSE_POSITIVE_WRONG_SECTOR`. Same town and
similar phonetic name (Giemme = Gi. Emme = "G. M." initials), but
distinct legal entity in a completely different sector (machine
tools vs real estate). Same family pattern as Chemello in F.1 —
shared surname/family/town, different business.

**Why pg4 accepted it:** distinctiveTokens = `['giemme']`, length 1,
not in `COMMON_BARE_STEMS`. Layer B fires.

**Surgical fix:** add `giemme` to `COMMON_BARE_STEMS`. Note that
this also resolves the F.1 INCONCLUSIVE on `giemme.com` (Joken JWT
bouncer): regardless of what the .com page renders behind the
challenge, the bare `giemme` stem is now blocked.

---

## Summary

| domain | result | classification | surgical fix |
| --- | --- | --- | --- |
| academy.it | FP | FP_GENERIC_HOMONYM (English-language school, Lazio) | + `academy` to COMMON_BARE_STEMS |
| giemme.org | FP | FP_WRONG_SECTOR (Gi. Emme Macchine Utensili, same town) | + `giemme` to COMMON_BARE_STEMS |

**2 / 2 confirmed FPs.** Resolves followup #19 (giemme inconclusive
from F.1) and #24 (academy audit from F.2).

## Code changes shipped in this commit

1. `semantic_evidence.ts` — `COMMON_BARE_STEMS` += {academy, giemme}.
   Each entry has an inline audit-evidence comment.
2. `tests/unit/preverify_gate.test.ts` — 2 new pinned cases (one
   per FP).

## p85 results (after F.3 fix)

| run | found | breaker end state | direct_fetch.success_rate | ledger summaries |
| --- | --- | --- | --- | --- |
| p84 (F.2)  | 53 | **CLOSED** ✓ | 0.4826 | 1 ✓ |
| **p85 (F.3)** | **53** | **CLOSED** ✓ | 0.4753 | 1 ✓ |

p85 net delta vs p84:
- **−2 lost**: Academy + Giemme — exactly the 2 audit FPs ✓
- **+2 gained**: Euganea Case + Liviana — newly-surfaced TPs that
  the looser breaker now lets the run reach (same family as p84's
  recovery of 5 leads vs p83)

Found count stays at 53 with strictly higher precision floor (2
confirmed FPs gone). All previously pinned TPs preserved (La
Chiave at `immobiliarelachiave.net`, Phosphoro at `phosphoro.com`).

## Direct_fetch breaker — confirmed stable across runs

| run | breaker state | success_rate | comment |
| --- | --- | --- | --- |
| p82 (F)    | OPEN ⚠ | 0.5789 | starvation |
| p83 (F.1)  | OPEN ⚠ | 0.4861 | starvation |
| p84 (F.2)  | CLOSED ✓ | 0.4826 | loose config |
| **p85 (F.3)** | **CLOSED** ✓ | **0.4753** | loose config holds |

Two consecutive runs with same network noise (~47-48 %
direct_fetch success rate) and the breaker now stays CLOSED. The
local transport substrate is **stable enough to enable Phase G**
paid Serper. Any remaining recall gap on Phase G can be attributed
to provider effectiveness, not local breaker starvation.

## Acceptance vs Phase F.3 spec

| criterion | target | result |
| --- | --- | --- |
| 437 in → 437 out | yes | ✓ |
| cost = 0 | yes | ✓ |
| 1 ledger summary | yes | ✓ |
| direct_fetch breaker closed at end | yes | **CLOSED** ✓ |
| Academy rejected | yes | ✓ |
| Giemme rejected | yes | ✓ |
| 35 prior denylist stems all clean | yes | ✓ |
| La Chiave + Phosphoro preserved | yes | ✓ |
| typecheck + tests green | yes | 362 pass / 1 skipped |

## Followups (post-F.3)

25. Phase G — paid Serper at €0.001/call with strict per-lead
    cost ceiling and explicit breaker-state inspection.
26. Per-host scoping for direct_fetch breaker (architectural
    improvement; #22 from F.2 doc).
