# Deep Research: Financials + Decision Makers

Date: 2026-03-26

## Scope

This dossier consolidates the five parallel research streams run on `pg3`:

1. financial recall
2. decision-maker recall
3. checker / observability
4. performance / cost
5. bonus feature

Primary files inspected:

- `src/foundation/BilancioHunter.ts`
- `src/enricher/runtime/stages/financial_enrichment_stage.ts`
- `src/enricher/core/directories/fatturato_italia.ts`
- `src/foundation/LinkedInSniper.ts`
- `src/enricher/runtime/stages/decision_maker_stage.ts`
- `src/enricher/runtime/stages/post_discovery_enrichment_stage.ts`
- `src/foundation/MasterPipeline.ts`
- `src/enricher/worker.ts`
- `src/enricher/db/index.ts`
- `src/shared-runtime/routing/CostRouter.ts`
- `src/shared-runtime/cache/MemoryFirstCache.ts`
- `src/shared-runtime/browser/BrowserPool.ts`

## Executive Summary

The strongest conclusion is simple:

- website discovery is now a first-class subsystem
- financial discovery is not
- decision-maker discovery is not

Both financials and decision makers are currently underpowered by design, not just by missing providers.

The biggest weaknesses are:

1. `BilancioHunter` is effectively a SERP + snippet heuristic, not a full financial subsystem.
2. `DecisionMakerStage` is effectively a single-source wrapper around `LinkedInSniper`.
3. `RuntimeStageOutcome` is too poor to explain why a stage failed, returned weak evidence, or matched the wrong entity.
4. `worker.ts` persists only website-led `FOUND_COMPLETE` records, which hides useful downstream evidence.
5. orchestration is still too row-oriented; repeated work across the same domain, company, VAT, or PG entity is not reused aggressively enough.

## Current-State Findings

### Financials

- `src/foundation/BilancioHunter.ts` issues one SERP query, picks one result, and often extracts only snippet-level revenue hints.
- `src/enricher/runtime/stages/financial_enrichment_stage.ts` merges `financial`, `employees`, and `vat` into one broad stage result, which blurs source trust and failure diagnosis.
- `src/enricher/core/directories/fatturato_italia.ts` is valuable but too isolated as a special harvester instead of being modeled as one lane in a governed financial pipeline.
- Financial data is treated too much as a side effect of the main enrichment, instead of as an evidence-backed subsystem with source ranking and field-level provenance.

### Decision Makers

- `src/enricher/runtime/stages/decision_maker_stage.ts` depends entirely on `LinkedInSniper`.
- `src/foundation/LinkedInSniper.ts` is single-query and single-result. It does not do robust reranking on company, city, domain, role, franchise, or branch ambiguity.
- `src/shared-runtime/routing/search_result_selectors.ts` effectively picks the first `/in/` profile match.
- `src/foundation/QuerySanitizer.ts` does not generate a rich enough query set for owner / amministratore / CEO / founder / branch-manager variants.

### Quality / Checker

- `RuntimeStageOutcome` does not carry enough structured diagnostic data.
- `MasterPipeline` creates stage outcomes, but `worker.ts` does not persist that granularity.
- `worker.ts` logs `SUCCESS` as long as the overall pipeline reaches `FOUND_COMPLETE`, even when downstream stages are `not_found` or `failed`.
- Confidence values are partly hardcoded and not calibrated against a benchmark set.

### Performance / Cost

- `src/enricher/runtime/stages/post_discovery_enrichment_stage.ts` runs financial, decision maker, employee estimation, and contacts sequentially even though they are mostly I/O-bound.
- Directory and website-derived work is still too row-scoped, not domain-scoped or entity-scoped.
- Caches are useful but not strong enough for cross-row reuse on shared domains, shared PG pages, or repeated company/VAT attempts.
- Negative caching and provider cooldown behavior should be more aggressive on failing queries.

## Top 10 Improvements By Leverage

1. Split financial enrichment into distinct lanes:
   - source discovery
   - entity match
   - field extraction
   - source trust
   - persistence

2. Replace single-source decision-maker discovery with a multi-source stage:
   - LinkedIn SERP
   - website signals
   - PG details
   - registry / company documents
   - buffered runner-ups

3. Enrich `RuntimeStageOutcome` with:
   - `reason_code`
   - `confidence`
   - `provider`
   - `source_url`
   - `attempted_count`
   - `evidence_count`
   - `entity_match_status`

4. Persist stage-level outcomes in DB, not just final flattened fields.

5. Decouple financial persistence from website success so useful evidence is not discarded when website validation fails.

6. Add domain-first and entity-first caching for repeated rows sharing:
   - domain
   - PG URL
   - VAT
   - normalized company + city

7. Replace one-shot `LinkedInSniper` selection with reranking on:
   - company token overlap
   - city / province overlap
   - validated domain overlap
   - branch/franchise ambiguity penalty
   - role quality

8. Add cheap pre-filters before expensive financial lanes:
   - VAT present
   - legal form present
   - strong entity match present
   - known dead query cooldown

9. Introduce field-level provenance:
   - `revenue_source`
   - `employees_source`
   - `vat_source`
   - `decision_maker_source`
   - `decision_maker_match_mode`

10. Build benchmark harnesses for:
   - financial recall
   - decision-maker recall
   - wrong-entity rate
   - franchise ambiguity

## Quick Wins

### Quick Win 1: Expand stage diagnostics

Refactor:

- `src/enricher/runtime/stages/stage_types.ts`
- `src/enricher/worker.ts`
- `src/enricher/db/index.ts`

Expected value:

- immediately reduces silent failures
- makes benchmarking possible
- gives clear reason codes for refactor prioritization

### Quick Win 2: Multi-query decision-maker search

Refactor:

- `src/foundation/QuerySanitizer.ts`
- `src/foundation/LinkedInSniper.ts`
- `src/shared-runtime/routing/search_result_selectors.ts`

Expected value:

- higher decision-maker recall without new infrastructure

### Quick Win 3: Treat financial signals independently from website success

Refactor:

- `src/enricher/worker.ts`
- `src/enricher/db/index.ts`

Expected value:

- preserves useful revenue / VAT / employees evidence even when website validation does not close cleanly

### Quick Win 4: Parallelize post-discovery stages

Refactor:

- `src/enricher/runtime/stages/post_discovery_enrichment_stage.ts`

Expected value:

- faster throughput on I/O-heavy enrichment

## Structural Refactor Plan

### Phase 1: Checker + Persistence

1. extend `RuntimeStageOutcome`
2. persist stage outcomes
3. split success semantics:
   - website success
   - contact success
   - financial success
   - decision-maker success

### Phase 2: Decision-Maker V2

1. replace `DecisionMakerStage` mono-source logic
2. add query variants and reranking
3. add source-specific reason codes:
   - `DM_NOT_FOUND`
   - `DM_LOW_CONFIDENCE`
   - `DM_WRONG_ENTITY`
   - `DM_FRANCHISE_AMBIGUOUS`
   - `DM_PROVIDER_BLOCKED`

### Phase 3: Financial V2

1. split `BilancioHunter` into:
   - financial source discovery
   - financial document candidate ranking
   - field extraction
2. make `fatturato_italia` a governed lane, not a special case
3. attach provenance per field

### Phase 4: Entity and Cache Layer

1. dedupe by domain, PG page, VAT, normalized entity
2. persist negative caching / cooldown for recurring failures
3. move repeated entity evidence into reusable memory

## Bonus Feature Recommendation

Recommended feature:

`email pattern inference + confidence`

Why this is the best bonus feature:

- it directly monetizes the work on website discovery, contacts, and decision makers
- it does not require a full rewrite
- it benefits from stronger domain validation and decision-maker recall
- it can be shipped in confidence tiers:
  - confirmed visible email
  - inferred company-pattern email
  - inferred personal decision-maker email

Suggested fields:

- `email_pattern`
- `pattern_source_email`
- `candidate_email_1`
- `candidate_email_2`
- `best_candidate_email`
- `email_confidence`
- `email_verification_mode`

Suggested rollout:

1. infer pattern only when at least one confirmed company email exists
2. generate decision-maker candidates only when name + domain are strong
3. label every candidate by confidence instead of claiming truth

## External Research Notes

The strongest external signal identified is that official Italian company-document ecosystems remain the best high-trust path for:

- administrators / legal representatives
- balance sheets
- company dossier data

Relevant reference entry points:

- `registroimprese.it`
- `Telemaco`
- company fascicolo / visura / bilanci products

These should be treated as high-trust targets for future integration, while keeping fallback web discovery as a secondary lane.

## Recommended Execution Order

1. checker / telemetry / persistence
2. decision-maker V2
3. financial V2
4. entity-resolution + franchise disambiguation
5. bonus feature `email pattern inference + confidence`

## Final Verdict

The codebase does not mainly need more providers. It mainly needs:

- better lane separation
- better evidence persistence
- better reranking
- better measurement

Financials and decision makers should be promoted to first-class subsystems, with the same rigor already applied to website discovery.
