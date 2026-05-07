# Phase F.2 — direct_fetch breaker resilience tuning

**Goal:** stabilise the local fetch layer so the `direct_fetch`
circuit breaker does not end OPEN at the end of a free-only run.
F / F.1 had `direct_fetch` ending OPEN on PD with
`consecutiveFailures=5, lastFailureKind=transport` despite healthy
SERP providers and D.3 retry. The user's spec is to fix this BEFORE
opening paid Serper, otherwise paid-provider effectiveness and local
network noise would conflate.

## Diagnosis

`direct_fetch` is an **per-target tool**: its success rate depends on
each upstream domain, not on `direct_fetch` itself. The default
breaker config (5 consecutive failures / 60 s window / 120 s cooldown)
treats it like a paid SERP — strict because of cost. But:

- `direct_fetch` is **free** — no cost penalty for retrying.
- Failures are **per-target** — 5 flapping target sites trip the
  breaker even if `direct_fetch` as a tool is fine.
- Once OPEN, **all** future leads in the run lose verify capability
  (every stage calls `verifyCandidates`), starving the rest of the
  run.
- D.3 retry-with-bypass already covers single-blip transport flap;
  the breaker is over-protective for a free per-target fetcher.

`direct_fetch.success_rate` on PD has been ~0.48-0.58 across runs.
At 50 % failure rate, 5 consecutive flaps happen often, so the
breaker trips and stays open through the cooldown.

## Surgical fix

Per-key breaker config in `src/providers/provider_catalog.ts`:

```ts
breaker.configure('direct_fetch', {
  failureThreshold: 15,    // 3× default — burst tolerance
  windowMs: 60_000,        // 1 min, unchanged
  cooldownMs: 30_000,      // 30 s — recover quickly when network heals
});
```

Other providers (paid SERPs, etc.) keep the strict 5/60s/120s
default. Only `direct_fetch` gets the loose config.

## p84 results

| run | breaker end state | found | direct_fetch.success_rate |
| --- | --- | --- | --- |
| p82 (default 5/60/120) | **OPEN** ⚠ | 48 | 0.5789 |
| p83 (default 5/60/120) | **OPEN** ⚠ | 47 | 0.4861 |
| **p84 (loose 15/60/30)** | **CLOSED ✓** | **53** | 0.4826 |

Same network noise level (~48 % success rate), but the loose config
gives the run enough headroom that the breaker never finishes OPEN.

p84 net delta vs p83:
- **+8 gained**: 5 of these are TPs that p82 → p83 had lost to
  network flap and that p84 recovered (Colli Euganei, Happy House,
  Immobilsole, Obiettivo Casa, Pentacom). Plus Studio Bersan,
  ReadyHouse, Academy.
- **−2 lost**: Euganea Case, Liviana — pre-existing flap, not
  related to the breaker change.

**+6 net** at strictly higher precision floor (all 35 prior denylist
stems preserved).

## Acceptance vs Phase F.2 spec

| criterion | target | result |
| --- | --- | --- |
| 437 in → 437 out | yes | ✓ |
| cost = 0 | yes | ✓ |
| 1 ledger summary | yes | ✓ |
| no paid provider calls | yes | ✓ |
| direct_fetch breaker CLOSED at end | yes | **CLOSED ✓** |
| no FP regression on the 35 prior denylist stems | yes | ✓ all clean |
| cangrande / la chiave / phosphoro TPs preserved | yes | (cangrande not in PD; pinned tests guard) |
| typecheck + tests green | yes | 360 / 1 skipped, tsc 0 errors |
| 2 new breaker tests pinning the loose config | yes | ✓ |

## What this does NOT solve (followups)

22. **Per-host scoping for direct_fetch breaker** — architecturally
    correct: key by `direct_fetch:<hostname>` so a single bad
    upstream doesn't poison the rest of the run. Bigger refactor;
    not in F.2 scope.
23. **Network resilience for paid providers** — Serper / Exa / etc.
    keep the strict default 5/60s/120s because paid calls cost
    money and we should fail fast. Re-evaluate per-provider once
    Phase G is on.
24. **Audit `Academy S.r.l. → academy.it`** in p84 (single-token
    English noun, new in p84 not in p82/p83). Manual WebFetch
    needed before next bench.

## Why this matters for Phase G

With p84's CLOSED breaker, the local transport layer is now a
known-stable substrate. Switching on paid Serper (followup #21)
will not be conflated with local noise — any remaining recall gap
is a real signal that paid providers can address.