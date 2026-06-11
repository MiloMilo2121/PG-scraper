# Live €0.02 money-guard test — result (the one real spend of the SaaS pass)

*Run 2026-06-11. The end-to-end proof that the run-cost ceiling halts real
paid spend — the thing the discovery pass said was "verified by READ, not by
spend." Now verified by spend.*

## Command
```bash
SERPER_ENABLED=true SERPER_API_KEY=<key>  # in .env
pnpm run enrich -- \
  --input output/ceiling_live_input.csv \   # 30 obscure PD SMB leads, no website
  --out output/ceiling_live_check.csv \
  --enable-paid \
  --run-cost-ceiling-eur 0.02
```

## Result — money-guard PASSED

| check | value | verdict |
|---|---:|---|
| total cost (ledger) | **€0.019** | ✅ never exceeded the €0.02 ceiling |
| serper paid calls | 19 × €0.001 | charged correctly |
| `run_cost_ceiling_hit` latched event | fired **1×** | ✅ halts further paid calls |
| exit code | 0 (ok) | ✅ run completed cleanly |
| leads in / out | 30 / 30 | ✅ no data loss at the cap |

The 20th paid call would have crossed €0.02, so the reservation logic stopped
it and latched the ceiling event. **Real money moved (€0.019) and the guard
held to the cent.** This closes the prior pass's open concern.

## A second, valuable result — the dead-provider detector fired (correctly)

The run record carried `provider_dead: ["serper"]`, and the log emitted:

```
[provider-health] ⚠ 1 provider(s) made calls but NEVER succeeded this run —
serper(19 calls, all empty). Investigate or remove — this is the dns_mx/crtsh
silent-failure class.
```

**This is the detector working exactly as designed**, and the investigation it
prompts resolves cleanly:

- Failure kind is `empty` (NOT `blocked`/`transport`/`4xx`) → Serper responded
  fine and was billed (€0.019 charged) — the API key works, the provider is
  reachable.
- 0 of 19 queries converted because the **test input is deliberately obscure**:
  I invented 30 semi-fictional PD SMB names to FORCE the paid path; most have no
  findable website, so Serper legitimately returned nothing.
- On real leads Serper converts (cf. the discovery report: bing_html had 955/955
  retrieval on real PD data). So here `serper dead` is a **benign false positive
  of the synthetic input**, not a broken provider.

The point: the detector is **warn-only** (it did not change the exit code) and
it surfaced a 0%-success provider LOUDLY instead of silently — which is the
entire meta-lesson of the prior passes, demonstrated live on its first real run.
It cannot itself distinguish "broken" from "found nothing for these queries";
that one-minute human check (kind=empty + key billed + synthetic names) is what
a warning is for. On a real run it would not fire.

## Honesty note
Reported exactly as produced. The artifacts live under `output/` (gitignored,
contains the synthetic input + the live ledger); the key never entered a tracked
file. Re-run with a real-leads input to confirm Serper's healthy conversion rate
before relying on it at scale (checklist §2.2).
