# VAT precision — measured, fixed, and the VIES caveat (Phase A.2)

*The master-key field. A wrong VAT poisons fatturato/dipendenti/PEC downstream,
so its precision matters most. Measured against the source, fixed, re-verified.*

## What the probe measured (the OLD extractor: footer VAT[0])
`probe_precision.ts --n 24` (real sites, €0, see `probe_precision_output.json`):
- **fill-rate 78.3%** (18/23 sites yielded a checksum-valid footer VAT).
- VIES name cross-check of those 18: 8 matched the company, **5 named a
  DIFFERENT company** (the footer cites the accountant's/partner's VAT), 5 VIES
  returned no name. So the footer-VAT[0] is the company's own only ~62% of the
  *verifiable* time — fill-rate 78% ≠ precision.

## The fix (`vat.vies_confirmed` in field_registry.ts)
Resolve the COMPANY'S VAT, not just footer[0]: VIES each candidate, pick the one
whose official name matches the company.
- VIES name matches company → **0.95** (`vat:vies_confirmed`).
- VIES names a DIFFERENT company → that candidate is foreign, skip it.
- VIES can't confirm (see caveat) → keep footer VAT at **0.6** (`vat:footer_unconfirmed`).
- Every candidate positively attributed to another company → **refuse** (the
  precision win: a proven-foreign VAT never fills, never poisons downstream).

## THE CAVEAT (caught by real-data verification — the discipline, a third time)
The first fix REJECTED Euganea's real, valid VAT (02440120281). Root cause:
**VIES only covers VATs registered for intra-EU trade. Most domestic-only Italian
SMBs are NOT in VIES** (isValid:false / no name) even though their VAT is
perfectly valid. So VIES is a CONFIRMER, not a domestic validator: a VIES miss
must NOT be a rejection. Corrected: only a positive "VIES names another company"
drops a candidate; a VIES miss keeps it at 0.6 unconfirmed.

## Real-data verification of the corrected resolver (VIES on, €0)
12 real PD companies with a footer VAT → **12 kept, 0 wrongly rejected**:
- 5 VIES-confirmed @0.95 (cross-border registered, name-matched).
- 7 footer-unconfirmed @0.6 (domestic-only, not in VIES — kept honestly).
- Euganea now correctly @0.6 (was wrongly REJECTED by the first cut).

## Honest precision statement for VAT (fill-rate ≠ precision)
- **fill-rate ≈ 78%** of website-having companies.
- of filled: **~40% VIES-confirmed (high precision, 0.95)**, **~60%
  footer-unconfirmed (0.6** — probably the company's, but VIES can't confirm
  domestic-only VATs).
- provable-foreign VATs (VIES names another company) are now **dropped**.
- the probe's "28% mismatch" is an UPPER BOUND on the foreign-citation problem;
  the conservative fix only drops the clear cases (0 in the 12-sample), so the
  real foreign rate is lower. Residual risk: a VIES name-format variant could
  rarely cause a false "confirmed/foreign" — the 0.5 token-overlap threshold is
  lenient to avoid false rejects.

## What this is NOT
Not a domestic VAT *validator* — that needs Registro Imprese (Phase C), not VIES.
VIES confirms the cross-border subset + flags clear foreign citations; the rest
is carried at honest low confidence with provenance, never as a sure thing.
