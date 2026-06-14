# Final validation audit — 3 independent samples, before push

*2026-06-14. The audit that earns the push. Ran the REAL pipeline on three
geographically-independent samples, sampled against the LIVE source, checked the
6 known bugs on fresh data. VERDICT: **ONE bug found (high-severity), fixed, golden'd
— re-run one fresh sample post-fix before push.** €0.*

## VERDICT — BUG FOUND + FIXED (re-validation recommended before push)
The 3-independent-sample design did exactly its job: it caught a real, high-severity
bug that all 806 green tests AND the single-sample census had missed. Sample S1
(Padova) had no franchise agency; sample S2 (Albignasego) did — and the divergence
exposed the bug. A single flattering sample would have shipped it.

### The bug: FRANCHISE-COLLISION → a franchisor's €58M attached to a local agency @0.95
A local "Agenzia Immobiliare **Tecnocasa** Impresa Albignasego" cites the
FRANCHISOR's VAT (Tecnocasa Franchising S.p.A., 08365160152) in its site footer —
normal for franchises. The pipeline then, in TWO layers:
1. `companyNameMatches` over-matched on the shared brand token "tecnocasa"
   (min-overlap = 1/2 = 0.5) → `vatResolve` FALSE-confirmed the franchisor's VAT @0.95.
2. the fatturato step trusts a 'site' VAT WITHOUT name-verification → fetched
   **Tecnocasa Franchising's €58.024.680** and attached it to the local agency.
Severity HIGH: wrong by ~1000×, at HIGH confidence (the worst kind), across a whole
CLASS (every franchise agency — Gabetti, Re/Max, Toscano, Grimaldi…), common in real estate.

### The fix (two layers, both at class-altitude — generalizes, not a renamed hole)
1. **`companyNameMatches`**: min-overlap → **containment OR Jaccard ≥ 0.5**. A single
   shared brand token across distinct entities no longer confirms (Tecnocasa: Jaccard
   0.17 → reject); the legit owner-suffix pattern is kept via containment ("Immobiliare
   Giglio" ⊆ "Immobiliare Giglio di Cecchinato Ornella"). Real-data goldens added.
2. **fatturato step ENTITY-VERIFICATION**: the VAT's REGISTERED name (returned by
   fatturatoitalia) must match the company — for ANY provenance. A different entity's
   firmographics are refused (`entity_mismatch` → `vat_unverified`). This is the layer
   that actually stops the €58M, because the revenue path trusts a 'site' VAT directly.
   Real-data golden added (franchisor refuse for revenue+employees, Euganea keep).
*Note: the post-fix re-run revealed layer-1 alone was insufficient (the revenue path
bypasses the VAT field) — the audit caught its own incomplete fix. Both layers needed.*

### Fix validation
- **811 tests green** (+5 real-data goldens: 2 companyNameMatches, 3 entity-guard).
- **Targeted re-audit** (new name-match on all 18 previously-confirmed VATs): 16 STAY
  confirmed, **2 correct rejects** — Tecnocasa (franchisor) + "Studio Novus" (whose
  registry name is "NOVUS CONSULENTI ASSOCIATI", a consultancy — the footer cites the
  consultant's VAT, same class as the original accountant-VAT bug). **Zero legit
  over-rejections.**
- **Live post-fix sample (S2post2)**: Tecnocasa revenue now EMPTY; legit (Cpr €2.04M,
  Edilbaraldo €2.13M) kept. The deterministic golden proves the €58M refusal (the live
  re-run is rate-limited-flaky from this session's testing, so the unit golden is the
  durable proof).

## The other 5 bugs — PASS on all 3 samples (fresh data)
| bug | S1 (Padova) | S2 (Albignasego/Vigonza) | S3 (Cittadella/Cadoneghe/Abano) |
|---|---|---|---|
| #1 fatturato = max-year | 5/5 ✓ | 4/4 ✓ | 3/3 ✓ |
| #2 dipendenti ranges (not "1015") | ✓ | ✓ (the "10-15" my check flagged = CORRECT vs source "da 10 a 15") | ✓ |
| #3 VAT confidence honest | ✓ all @0.95 or @0.6 | ✓ | ✓ |
| #4 rate-limit, no silent 0-fill | 0 drops / 4 genuine no-data | 0 / 2 | 0 / 1 |
| #6 no dead tier + provenance honest | 0 issues ✓ | 0 ✓ | 0 ✓ |
| structural ceiling = honest empties | 5/14 filer, rest empty ✓ | 4/14 ✓ | 3/14 ✓ |

Note on #2: my audit CHECK had a false-positive ("10-15" → digit-strip "1015" → flagged);
the pipeline output "10-15" is CORRECT, verified against the live page's "da 10 a 15".
The audit tool was wrong, the data was right — sampled against source, as required.

## Per-field fill + precision — HONEST RANGES across the 3 samples (not the best number)
| field | FILL-RATE range | PRECISION (sampled vs source) |
|---|---|---|
| email | 43–64% | **100% same-domain** (21/21 across samples) |
| social (fb/ig/li) | fb 50–57% · ig 21–43% · li 7–21% | 42/43 profile-shaped; ownership not auto-verifiable |
| VAT | 57–86% | ~40% VIES-confirmed @0.95 · ~60% footer @0.6 · franchisor/consultant VATs now REFUSED |
| PEC | 0–21% | high where present (certified-domain) |
| revenue | 21–29% | official source, entity-verified; high precision (was the bug, now gated) |
| dipendenti | 7–21% | correct ranges (golden-locked) |

Divergence note: VAT fill in S2 dropped 71%→57% post-fix — that's the franchise/
consultancy VATs correctly refused, not a regression.

## The owner's 10-row fatturato source-check (folded in, vs the LIVE page's own headline)
| company | pipeline | page headline | match |
|---|---|---|---|
| Euganea Case | € 51.619 (2024) | € 51.619 (2024) | ✓ |
| Immobiliare Metroquadro | € 1.715.785 (2024) | € 1.715.785 (2024) | ✓ |
| Agedi Case | € 111.390 (2024) | € 111.390 (2024) | ✓ |
| Liviana Immobiliare | € 127.934 (2023) | € 127.934 (2023) | ✓ |
| Arcos Immobiliare | € 24.719 (2024) | € 24.719 (2024) | ✓ |
| Cpr | € 2.036.043 (2024) | € 2.036.043 (2024) | ✓ |
| Immobiliare Edilbaraldo | € 2.128.318 (2024) | € 2.128.318 (2024) | ✓ |
| Consulenti Associati | € 558.438 (2023) | € 558.438 (2023) | ✓ |
| Immobiliare Baggio | € 1.289.353 (2024) | (title format, no meta) → chart max-year = 1.289.353 (2024) | ✓ |
| **Agenzia Tecnocasa Albignasego** | ~~€ 58.024.680~~ | franchisor's number — **THE BUG** | ✗ → FIXED (now refused) |
**9/10 correct against source; the 10th was the bug, now fixed.** (Baggio's "no-headline"
was my check's title-format false-negative; the chart max-year is correct.)

## DEFINITION OF DONE
- [x] 3 independent samples, full pipeline, per-field fill + precision vs source
- [x] 6 bug-checks pass/fail per sample (5 pass; #VAT-class bug found + fixed)
- [x] Cross-sample consistency reported as honest ranges
- [x] Structural ceilings confirmed as honest empties (not bugs)
- [x] 10-row fatturato source-check folded in (9/10 + the bug, now fixed)
- [x] VERDICT: bug-found → fix + 5 real-data goldens; 811 green; €0; nothing pushed
- [ ] **RE-AUDIT BEFORE PUSH**: run ONE fresh sample post-fix when fatturatoitalia
      isn't rate-limited from this session, confirm Tecnocasa-class agencies show
      honest-empty fatturato — then the owner's 10-row check → push.

## Bottom line
The pipeline is now MORE correct than before the audit: the 5 prior bugs hold, and a
6th class (franchise/chain VAT collision) — invisible to green tests, hidden by a
single sample — was caught on fresh independent data, fixed at the right altitude with
real-data goldens, and validated. Not a clean "clear to push": a bug was found, so the
discipline says re-audit one fresh sample post-fix first. But the chapter closes on a
measured truth, and the franchise class will never silently attach a franchisor's
revenue again.
