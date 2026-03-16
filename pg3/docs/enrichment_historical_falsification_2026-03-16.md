# Historical Falsification Review

Date: 2026-03-16

Purpose: record which enrichment ideas are already contradicted or heavily constrained by older logs, validations, and recovery runs, so the next plan does not repeat known failure modes.

## Executive Conclusion

The old logs do not say "phone is useless" or "search is useless". They say the following:

1. Free or weak search lanes without strong infrastructure fail too often to be the backbone.
2. Phone is valuable as an exact verification signal, but dangerous as a free-form identity seed.
3. Directory/profile sources can help resolve legal identity, but they are not official-site truth.
4. Loose semantic validation creates a large false-positive regime.
5. Browser-heavy deep verification is too fragile to be the default hot path.

That means some recent ideas remain valid only in stricter form:

- `phone lane`: yes, but only exact-phone/entity/address constrained.
- `directory/entity providers`: yes, but as separate terminal states or supporting evidence.
- `paid search APIs`: yes, because old free-search-heavy paths already underperformed.
- `browser pool / Browserless / Crawlee`: useful for runtime stability, not a primary answer to accuracy.

## Historical Evidence

### 1. Weak search without proxy was already degraded

Evidence:

- `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/output/e2e_tests/officine_metalmeccaniche_treviso_20260210_105004/worker.log`
  - line 22: `Proxy Disabled: Skipping Google, using Bing + DuckDuckGo`
  - line 162: `Proxy disabled and SCRAPE_DO_TOKEN missing - skipping Google name-based financial search`
  - line 217: `DeepVerify Navigation failed ... net::ERR_BLOCKED_BY_CLIENT`
- `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/output/e2e_tests/officine_metalmeccaniche_treviso_20260210_101552/worker.log`
  - line 22: `Proxy Disabled: Skipping Google, using Bing + DuckDuckGo`
  - line 126: `DeepVerify Navigation failed ... net::ERR_BLOCKED_BY_CLIENT`
- `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/output/e2e_tests/officine_metalmeccaniche_treviso_20260210_022800/summary.json`
  - `website_validated_count: 5 / 20`
- `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/output/e2e_tests/officine_metalmeccaniche_treviso_20260210_101552/summary.json`
  - `website_validated_count: 7 / 20`
- `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/output/e2e_tests/officine_metalmeccaniche_treviso_20260210_102128/summary.json`
  - `website_validated_count: 8 / 20`

Falsified hypothesis:

- "Bing + DuckDuckGo + no proxy is good enough as a core discovery strategy."

Correction:

- Use strong paid SERP as the default backbone.
- Keep DDG only as opportunistic fallback with cooldowns and anti-bot monitoring.
- Never design the hot path assuming missing proxy / missing search infra is acceptable.

### 2. Raw phone-number identity resolution was noisy and often pointless

Evidence:

- `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/output/runner_recovery.log`
  - line 126334: `Resolving identity for: 0383 365226"`
  - line 126344: `Identity resolution failed for 0383 365226"`
  - line 126788: `Resolving identity for: 0383 641535"`
  - line 126814: `Identity resolution failed for 0383 641535"`
  - line 127363: `Resolving identity for: 0383 373601`
  - line 127375: `Identity resolution failed for 0383 373601`
- `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/output/bulletproof/run1_not_found.csv`
  - multiple companies have phone values but still end as `fast_exhausted`
- `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/output/bulletproof/run2_not_found.csv`
  - the same pattern remains under `deep_exhausted`

Falsified hypothesis:

- "If we do a phone lane by searching from the raw phone number, enrichment rate will jump."

Correction:

- Never feed raw phone text into general identity resolution as the primary method.
- Phone should be used in these ways only:
  - exact match against already discovered candidates
  - exact lookup in PG / structured directories / Places-like APIs
  - evidence boost when phone, name, and geography all agree

### 3. Directory/entity pages were frequently mistaken for useful identity endpoints

Evidence:

- `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/output/runner_recovery_v2.log`
  - line 120: `Profile found: https://www.fatturatoitalia.it/tecno_system_srl-11013400152`
  - line 121: `Profile found: https://www.fatturatoitalia.it/ateco/43_21_01/191`
  - line 127: `Profile found: https://www.fatturatoitalia.it/pm-free-srl-11077280961`
  - line 141: `Profile found: https://m.fatturatoitalia.it/dettagliodettagliocmc-antideflagranti-srl-03211900158`
- `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/output/runner_recovery.log`
  - line 129380: `JinaVerify Insufficient content {"url":"https://fatturatoitalia.it"}`
  - line 129688: `DeepVerify Low confidence (0.02) for https://fatturatoitalia.it`

Falsified hypothesis:

- "More directory/entity sources automatically improve official-site discovery."

Correction:

- Separate `DIRECTORY_VERIFIED` from `OFFICIAL_SITE_VERIFIED`.
- Treat entity/profile pages as legal-identity evidence or fallback identity pages.
- Do not let these pages count as official websites unless a real official domain is extracted and verified.

### 4. Loose semantic validation produced many false positives

Evidence:

- `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/output/bulletproof/run1_found_invalid.csv`
  - `PM Free -> https://www.pmfree.it` invalid
  - `C.M.C. Antideflagranti S.r.l. -> https://www.cmcantideflagranti.it/` invalid
  - several invalids have validation reason `strong name match, domain match`
- `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/output/bulletproof/run2_found_invalid.csv`
  - `Pfg S.n.c. -> https://pfgitalia.com` invalid
  - `Sai S.r.l. -> https://saisrl.net` invalid
  - `Roem S.r.l. -> https://roem.com` invalid
  - `Trevi S.p.a. -> https://trevi.it` invalid
  - dominant invalid reason: `strong name match, domain match`

Aggregate counts from bulletproof CSVs:

- `run1_found_invalid.csv`
  - 11 invalid rows
  - methods: `hyper_guesser 5`, `search_contact_vector 4`
  - top reason: `strong name match, domain match`
- `run2_found_invalid.csv`
  - 100 invalid rows
  - methods: `hyper_guesser 86`, `paginegialle_phone 7`, `duckduckgo 5`
  - top reason: `strong name match, domain match` with 60 rows
- `run1_found_valid.csv`
  - 139 valid rows
  - top reason: `PIVA Match` with 130 rows
- `run2_found_valid.csv`
  - 83 valid rows
  - top reason: `VAT match` with 51 rows
  - second cluster: `phone match + strong name + geography/address`

Falsified hypothesis:

- "Strong name match + domain match is good enough to widen acceptance."

Correction:

- Official-site acceptance must require stronger evidence:
  - VAT match
  - or exact phone plus strong name plus geographic consistency
  - or multiple exact business signals on official pages
- Do not relax validation just to move the topline success rate.

### 5. Browser-heavy verification was already brittle

Evidence:

- `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/output/e2e_tests/officine_metalmeccaniche_treviso_20260210_101552/worker.log`
  - repeated `DeepVerify Navigation failed ... net::ERR_BLOCKED_BY_CLIENT`
- `/Users/marcomilanello/Documents/PG scraper ecc/PG/pg3/output/e2e_tests/officine_metalmeccaniche_treviso_20260210_105004/worker.log`
  - repeated `DeepVerify Navigation failed ... net::ERR_BLOCKED_BY_CLIENT`
  - `ScrapeDDGDIY Blocked by anti-bot gate`

Falsified hypothesis:

- "If we just add more browser horsepower or browser infrastructure, accuracy will solve itself."

Correction:

- Use browser verification only after deterministic or paid-search pruning.
- Browserless/Crawlee can improve orchestration and stability, but they do not fix bad candidate generation or loose validation.

## What This Means For Recent Proposals

### Keep, but constrain hard

1. Input website lane.
   This is still correct. It uses deterministic user-provided signal rather than noisy discovery.

2. Phone lane.
   Keep only as:
   - exact phone lookup in PG / structured providers
   - evidence booster for candidate verification
   - optional lookup in Places-like structured APIs
   Reject raw phone-to-name search as a default identity step.

3. Paid SERP backbone.
   Keep. Old logs make this more necessary, not less.

4. Directory/entity providers.
   Keep only for:
   - identity confirmation
   - VAT/legal entity validation
   - `DIRECTORY_VERIFIED` terminal state
   Not for direct official-site success accounting.

5. Browserless / Crawlee / autoscaling.
   Keep as runtime tools only. They are not enrichment-rate silver bullets.

### Downgrade or reject

1. Free-search-first strategy.
   Reject as the backbone.

2. Raw phone identity resolution.
   Reject.

3. Relaxed semantic acceptance.
   Reject.

4. Counting directories as website success.
   Reject.

5. Browser escalation as default.
   Reject.

## Revised Bulletproof Constraints

Any serious `90%+ web identity resolved` plan must obey these constraints:

1. Distinguish outcome classes:
   - `OFFICIAL_SITE_VERIFIED`
   - `OFFICIAL_SITE_PROBABLE`
   - `DIRECTORY_VERIFIED`
   - `NO_WEB_IDENTITY`

2. Never let raw phone search act as free-form company discovery.

3. Never count directory pages as official-site success.

4. Never rely on weak search infrastructure as the main lane.

5. Never widen acceptance without stronger evidence than name/domain similarity.

6. Keep browsers behind deterministic and paid-search filtering.

## Immediate Design Implication

The next architecture should be:

`input website -> pg_url -> exact phone/entity lane -> exact address/entity lane -> paid SERP -> strict verifier -> browser slow lane -> directory classified state`

Not this:

`raw phone/name search -> free SERP -> semantic guess -> browser escalation -> count directory as success`

## Bottom Line

The old logs do not invalidate the goal of a higher enrichment rate.

They invalidate the sloppy versions of that goal.

To improve safely, we need:

- better routing
- stronger evidence thresholds
- separate terminal states
- less reliance on brittle discovery paths

That is the only version of the plan that does not repeat already documented failure modes.
