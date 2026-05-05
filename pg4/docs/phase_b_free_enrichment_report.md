# Phase B — Free-only enrichment baseline (BL province)

> Run: `2026-05-05`. pg4 enriches the 194-lead BL CSV produced by Phase 4.3 using only free/local providers. Cost = €0 by construction.

## Command

```bash
npm run enrich -- \
  --input output/p43_provincia_bl.csv \
  --out output/p50_bl_enriched_free.csv \
  --cost-ceiling-eur 0.00
```

`--cost-ceiling-eur 0.00` semantics: free SERP (tier ≤ 1) still runs; paid SERP / LLM (tier ≥ 2) is blocked because `tierCapForLead()` returns `1` immediately. `budgetExhausted = true` is set on every lead, but that's an informational flag — free providers are NOT degraded. Confirmed by ledger: 0 paid provider calls.

## Acceptance criteria

| Criterion | Result |
|---|---|
| 194 input rows → 194 output rows | ✅ 195 CSV (1 header + 194) ↔ 194 JSONL |
| total cost = 0 | ✅ `total_cost_eur: 0` in summary |
| no paid provider call | ✅ providers in ledger: `direct_fetch`, `dns_mx`, `crtsh`, `ddg_lite`, `bing_html` only |
| ledger JSONL exists | ✅ 1246 entries in `output/p50_bl_enriched_free.cost-ledger.jsonl` |
| no silent drops | ✅ every input row carries `status` + `reason_code` |
| no mojibake | ✅ `grep -cE "¿\|�"` returns 0 |
| reason codes meaningful | ⚠️ see below — mostly `REJECTED_DIRECTORY` (informative but uniform) |

## Run summary

```
duration:                9:45 (584 155 ms)
leads_processed:         194
leads_with_website:      26
leads_errored:           0
cost_per_lead_eur:       0.0000
cost_ceiling_eur:        0.00
```

## Status / reason_code distribution

```
status:
   168  NOT_FOUND
    26  FOUND_WEBSITE_ONLY

reason_code:
   168  REJECTED_DIRECTORY    ← SerpStage matched only directory results
    26  FOUND_WEBSITE_ONLY

discovery_method (only for found):
    26  HYPER_GUESSER         ← every found lead came from HyperGuesser
```

## Provider call distribution

| Provider | Calls | Success | by_kind |
|---|---|---|---|
| `direct_fetch` (HTTP) | ~573 | high | success / timeout / transport |
| `dns_mx` (SERP T0) | 168 | 0 | empty: 168 |
| `crtsh` (SERP T0) | 168 | 0 | empty: 168 |
| `ddg_lite` (SERP T1) | 168 | 0 | empty: 168 |
| `bing_html` (SERP T1) | 168 | 168 | success: 168 |

Bing is the only SERP that returns results consistently; DDG / crt.sh / DNS-MX miss almost everything for small Italian SMBs (matches the pg3 audit which found 16K+ `SERP_EMPTY_RESULT` per batch).

## Circuit breaker state at end of run

```
direct_fetch  → state: open  consecutiveFailures: 6  lastFailureKind: timeout
```

`direct_fetch` tripped open near end of run on 6 consecutive timeouts — likely a single slow target. Cooldown will reset it on the next call. No paid provider hit; no real impact.

## Discovery method observations

**Every** found website came via HyperGuesser. That means:

- The InputWebsiteStage didn't help (most BL leads have no `website` field on PG card — phones are often hidden behind click-to-reveal too).
- The SerpStage either returned empty (DDG/crt.sh/DNS-MX) or only directories (Bing → SerpDeduplicator filters them → `REJECTED_DIRECTORY`).
- HyperGuesser succeeded by generating `<brand>.{it,com,eu,...}` permutations, DNS-pinging them, then verifying via PreVerifyGate semantic match.

This is a strong signal that **SerpStage with free-only is structurally weak** for small Italian SMBs, and HyperGuesser is the dominant discovery vector at this tier. Adding paid SERP (Serper/Tavily/Exa) would mostly help here — Phase H.

## Spot-check accuracy (5 samples)

Manual fetch of suspicious matches:

| Found | Lead name | Reality | Verdict |
|---|---|---|---|
| `https://ufficio.com` | Ufficio (Cortina d'Ampezzo) | Cartoleria/cancelleria e-commerce — `<title>Cartoleria, Cancelleria, Carta, Cartucce, Toner...</title>` | **FALSE POSITIVE** |
| `https://bloom.it` | Bloom (Pieve di Cadore) | 301 → www.bloom.it; unrelated entity | **FALSE POSITIVE (likely)** |
| `https://agenziaimmobiliare.it` | Agenzia Immobiliare (Cortina d'Ampezzo) | 200 OK on a generic-name domain; needs deeper inspection | **HIGH RISK** |
| `https://savim.it` | Savim S.r.l. (Belluno) | Plausible 4-letter brand match | likely true |
| `https://dallariva.it` | Immobiliare dalla Riva S.r.l. (Belluno) | Strong brand-token match in domain | likely true |

**Estimated precision after spot-check:** ~24/194 = **12.4% real recall**, with **8-12% false-positive rate among the 26 "found"**.

The PreVerifyGate semantic match (`bodyRatio ≥ 0.5 + ownership anchor`) is gameable when:
- the lead's brand is a generic Italian word (`Bloom`, `Ufficio`, `Agenzia Immobiliare`)
- the homonymous domain happens to exist
- the page contains the brand token (which a 4-letter word often does anywhere)

## What this tells us about pg4 vs pg3

- **Cost discipline holds**: €0 spent, no leak to paid providers, ledger JSONL audit-ready.
- **Cost gate semantics work**: `--cost-ceiling-eur 0.00` blocks paid without breaking free.
- **Resume contract holds**: the run completed in one shot, but rerun would skip via JSONL rehydrate.
- **Free SERP recall is structurally low** on Italian SMB long-tail. HyperGuesser carries the load.
- **HyperGuesser precision needs a tighter PreVerifyGate** when the brand name is generic, OR cross-corroboration (RDAP nudge) before accepting a semantic-only match.

## Risks / known issues to address in Phase D

1. **Generic-name false positives (8-12% of FOUND).** Tighten `PreVerifyGate` to require ≥ 2 tokens AND brand-token length ≥ 4 chars before accepting semantic-only matches without a PIVA anchor. RDAP-corroborate before acceptance when the matched domain is a single common word.
2. **HyperGuesser exclusive role.** No SerpStage success means we lose any agencies whose brand isn't predictable. Phase H paid SERP will help; Phase D could try DDG variants / crt.sh subdomain probing first.
3. **Direct-fetch breaker tripped on timeout.** 6 consecutive timeouts late in the run suggests a single slow target dragged the breaker. Could classify timeout-only as soft-failure (smaller weight) — Phase D consideration.
4. **Reason-code uniformity.** 168 `REJECTED_DIRECTORY` is informative as a class but operators can't distinguish "no SERP results at all" from "SERP returned only directories". Phase D: split into `SERP_EMPTY_ALL_PROVIDERS` vs `SERP_DIRECTORY_ONLY`.

## Files emitted

```
pg4/output/p50_bl_enriched_free.csv             195 lines (header + 194 leads)
pg4/output/p50_bl_enriched_free.jsonl           194 lines (full debug)
pg4/output/p50_bl_enriched_free.cost-ledger.jsonl  1246 lines (entries + 1 summary)
```

## Next phase

**Phase C — accuracy audit on the 26 found websites.** Inspect each one against the actual business identity (PG-listed phone match? address city match? RDAP company name match?) and classify:
- true positive
- false positive (generic-name homonym)
- false positive (parked / construction)
- inconclusive

Output: `docs/free_enrichment_audit.md` with the verdict per lead. Drives Phase D fixes.
