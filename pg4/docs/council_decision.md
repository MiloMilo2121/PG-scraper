# LLM Council — pg4's first spend decision (build-vs-buy-vs-bypass)

*Run via the `llm-council` skill (Karpathy methodology: 5 independent advisors →
anonymized peer review → chairman synthesis). 2026-06-14. €0 (reasoning only).*

## Context-hygiene note (REQUIRED by the mission)
The `llm-council` skill itself is GreenWatt-free — it's the clean generic Karpathy
method (5 thinking-lenses, parallel sub-agents, anonymized review, chairman). The
ONE GreenWatt vector is its step-1 instruction to "scan CLAUDE.md / memory for
context" — those files carry AXEND/GreenWatt baselines (burn rates, Kill Gates,
dossier framing). **KEPT:** the council mechanics. **STRIPPED:** the CLAUDE.md
context-scan — every advisor was fed a pg4-ONLY framed question with an explicit
"ignore GreenWatt/energy/AXEND, reason only about pg4" instruction. No GreenWatt
figure or frame entered the council. (Advisors ran as 5 parallel Sonnet sub-agents;
peer review as 5 more; chairman synthesized by the orchestrator with all material.)

## The framed question
How pg4 closes its one FRAGILE field (VAT ~78% filled, only ~40% VIES-confirmed
@0.95, ~60% footer-unconfirmable @0.6) plus coverage/PEC/decision-maker, choosing:
**(A)** pay the official registry API (Openapi — IT-search ATECO+province enum FREE
≤100/day, IT-pec €0.03/30-free-mo, IT-advanced incl. legal-representative €0.10),
**(B)** stay free / consolidate, **(C)** bypass government captchas (2Captcha
~€0.001-0.003, ToS-violating, still fragile scraping). The owner's economic point —
per-lookup cost is trivial at scale — to be engaged on merits, not dismissed.

---

## Where the Council Agrees (high-confidence — independent convergence)
1. **Option C is dead — unanimous, and NOT on cost.** Every advisor + every
   reviewer killed it on PROVENANCE: a SaaS whose moat is "clean official Italian
   data" cannot launder INI-PEC/Agenzia-Entrate data through a captcha-solver —
   it collapses at the first enterprise due-diligence call, gives data *lower*
   legal standing than a competitor licensing CCIAA, AND still leaves the fragile
   HTML scraping that produced all 5 prior bugs. "Economically correct, legally
   suicidal" (D). The owner's cents-at-scale point is real and still loses — the
   counter is legal/provenance/maintenance, exactly as briefed.
2. **Option A (Openapi) is the path; B (stay free) is insufficient.** 4/5 advisors
   chose A outright; the 5th (Contrarian) accepts A but gates it on unit-economics.
   B is "at ceiling on every field that matters — we get the easy companies global
   tools already have, that's not a product."
3. **PEC (IT-pec €0.03) is the highest-leverage FIRST endpoint** — it's the most
   monetizable Italian-B2B field (certified direct-reach to the decision-maker),
   and it's the cheapest. Revenue/employees (IT-advanced €0.10) second.
4. **Provenance is the product, not a compliance checkbox.**

## Where the Council Clashes — the first move
The genuine disagreement is sequencing, and the four first-moves are reconcilable:
- **Executor:** build the €0 free-tier comparison slice FIRST (field-by-field,
  free-scrape vs Openapi free tier) → that's the go/no-go for paid.
- **First Principles:** lead with IT-pec — it's the revenue endpoint.
- **Expansionist:** lead with IT-search ENUMERATION — map the legal universe (the
  thing the free-scrape census failed to get) and build a vertical "list-factory"
  product; the legal-representative field shifts the ICP to contact-ready lists at
  a 5-10x price point.
- **Contrarian:** before ANY commit, validate the unit economics against a real
  client price (10k companies × €0.10 = €1k raw before infra — does the SaaS price
  absorb it?). Legally-clean but economically-inverted is still a failure.

**Resolution:** the free-tier comparison slice is the move that satisfies all four
at €0 — it measures the field-level uplift (First Principles' "does PEC/VAT actually
lift?"), tests the enumeration thesis on a real province (Expansionist), and feeds
the Contrarian's unit-economics with real per-field numbers instead of guesses.

## Blind Spots the Council Caught (emerged ONLY in peer review)
1. **Openapi's own redistribution license (the killer).** Openapi is a
   reseller/aggregator. If its ToS forbids downstream redistribution of INI-PEC /
   registry data inside a third-party SaaS, **Path A collapses to C's legal
   exposure, just slower.** Verify BEFORE claiming an "official provenance" moat.
2. **Free-tier rate-limit vs scale.** IT-search is 100/day free; Italy has ~6.2M
   active VATs. The enumeration-first thesis (Expansionist) may be operationally
   infeasible on the free tier — the slice must test feasibility + the paid-tier
   bulk price, not assume it.
3. **Data freshness / the temporal moat.** Every advisor treated enrichment as a
   one-time lookup. Official data goes stale (legal rep, PEC, ATECO,
   active/liquidated change continuously). Without TTL/re-query/staleness surfacing
   a "list factory" sells stale official data. The DURABLE moat is a curated corpus
   + proprietary signal accumulated over time (PEC bounce, outreach response,
   lifecycle events) — not raw registry access, which is a race-to-zero commodity.
4. **PEC is a certified legal channel with a regulatory tailwind.** PEC→PEC isn't
   subject to cold-email restrictions, and INAD / mandatory-PEC pushes make PEC
   demand government-driven — raising its monetization ceiling well above a "5%
   fill field." (The Outsider mispriced it; the reviewers corrected it.)

## The Recommendation
**Path A (Openapi), measure-first. Build the €0 free-tier comparison slice on ONE
ATECO+province before spending a euro on IT-advanced.** Kill C. Don't settle for B.
Sequence: (1) verify Openapi's redistribution license; (2) €0 slice — current
free-scrape vs Openapi free tier (IT-search ≤100/day + 30 free IT-pec) on
real-estate 68.31 + PD, field-by-field: VAT confidence 0.6→confirmed, PEC fill,
decision-maker fill, revenue/employees; (3) decide IT-advanced (€0.10) on the
measured uplift + a real client-price unit-economics check. The slice resolves the
owner's economic question with his own numbers at €0 and zero ToS risk.

### Flip conditions (when this verdict changes)
- **License forbids SaaS redistribution** → A's moat is void; pivot to a properly
  licensed CCIAA/Registro-Imprese feed, or B + an explicit "validation-grade, not
  redistributable" product framing. (Highest-priority check.)
- **Slice shows negligible uplift** (PEC/VAT/decision-maker don't materially beat
  free) → stay B, bank the saving.
- **Unit economics invert** (no viable client price absorbs €0.10/co + infra) →
  re-scope to enumeration + PEC-only (the cheap, high-value subset), defer IT-advanced.

## The One Thing to Do First
**Verify Openapi's redistribution/ToS terms AND build the €0 free-tier comparison
slice (real-estate 68.31 + PD) — current free-scrape vs Openapi free tier,
field-by-field. €0 spent, no captcha bypassed, no IT-advanced commit until the
numbers + the license are in.**
