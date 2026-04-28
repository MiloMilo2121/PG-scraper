# Historical Logs Error Report

Date: 2026-03-16

## Scope

This report summarizes the major recurring failures found across the historical PG3 logs and validation artifacts.

Included:

- all `.log` files under `pg3`, excluding `temp_profiles`, `node_modules`, and browser storage under `search_profile_scraper/Default`
- historical bulletproof validation CSVs under:
  - `output/bulletproof`
  - `output_server/bulletproof`
- historical scraping logs for Treviso and Lombardia generation logs

Excluded:

- browser profile storage noise
- DB files
- generic CSV campaign dumps without error semantics

## Corpus Size

Relevant corpus:

- `33` log files
- `6,773,799` total lines

Top files by size:

1. `6,617,247` lines: `output_server/enrichment_meccatronica.log`
2. `136,024` lines: `output/runner_recovery.log`
3. `13,838` lines: `output/runner_recovery_v2.log`
4. `1,996` lines: `output_server/generation_lombardia.log`
5. `1,607` lines: `output/enrichment_meccatronica.log`

Consequence:

- the historical error profile is dominated by the large meccatronica enrichment run
- recovery logs and E2E logs are still essential because they expose causal failure modes not obvious from topline counts alone

## Level Distribution

Across all included logs:

- `PLAIN`: `6,261,331`
- `INFO`: `356,027`
- `WARN`: `123,413`
- `ERROR`: `33,007`
- `DEBUG`: `21`

Important note:

- many browser and shell-originated failures are emitted as `PLAIN` lines, so looking only at `WARN` and `ERROR` understates some infrastructure failures

## Main Findings

### 1. Browser runtime instability was the biggest historical problem

This is the single largest issue family.

Counts:

- `BROWSER_LAUNCH_ZYGOTE_SANDBOX_ERROR`: `110,195`
- `BROWSER_RESTART_UNHEALTHY`: `71,588`
- `GOOGLE_SEARCH_LAUNCH_FAILED`: `8,584`
- `DDG_SEARCH_LAUNCH_FAILED`: `8,490`
- `DEEPVERIFY_BROWSER_LAUNCH_FAILED`: `2,041`

Representative symptoms:

- `Failed to launch the browser process`
- `Zygote cannot be disabled if sandbox is enabled`
- `Restarting unhealthy browser`

Why it matters:

- this is not a minor side issue; it repeatedly crippled search, verification, and deep verification
- a large share of provider-level failures were downstream symptoms of browser launch failure, not intrinsic provider failure

Practical conclusion:

- browser process policy and runtime configuration were historically one of the biggest root causes
- any accuracy plan that relies heavily on browser-first verification is structurally unsafe unless browser runtime is fixed first

### 2. Jina was a major source of fragility

Counts:

- `JINA_VERIFY_INSUFFICIENT_CONTENT`: `26,554`
- `JINA_SEARCH_NON_200`: `11,628`

Why it matters:

- Jina failed both as verifier and as search source
- this created both throughput loss and false-negative pressure

Practical conclusion:

- Jina cannot be assumed to be a reliable hot-path dependency
- it should be either demoted, budgeted explicitly, or wrapped in much stronger fallback logic

### 3. LLM infrastructure was repeatedly degraded by rate limits and null responses

Counts:

- `LLM_RATE_LIMIT_429`: `15,723`
- `AGENT_LLM_NULL_RESPONSE`: `6,234`
- `LLM_COMPLETE_FAILED`: `3,117`
- `LLM_LEGACY_FALLBACK_FAILED`: `3,117`
- `LLM_STRUCTURED_OUTPUT_FAILED`: `3,331`
- `LLM_CACHE_SET_FAILED`: `575`

Representative symptoms:

- `Structured output failed with model glm-5`
- `Agent gave up: LLM returned null response`
- `Reached the max retries per request limit`

Why it matters:

- when the system fell back to semantic/agentic steps, the LLM layer often became unstable exactly when it was needed most
- this amplified failure cascades instead of rescuing them

Practical conclusion:

- LLM-heavy rescue lanes cannot be treated as a dependable default
- deterministic lanes must carry more of the workload

### 4. GhostHunter was heavily rate-limited

Counts:

- `GHOSTHUNTER_429`: `10,732`

Why it matters:

- Wayback/snapshot recovery existed, but at scale it was hammered into 429 rate limiting
- this makes it useful as a selective rescue lane, not as a broad fallback relied on under load

### 5. Identity resolution was noisy and often underperformed

Counts:

- `BING_FAILED_SERPER_FALLBACK`: `895`
- `IDENTITY_RESOLUTION_FAILED`: `580`
- raw phone-like identity attempts: `239`
- raw phone-like identity failures: `239`

Representative failure mode:

- the system sometimes tried to resolve companies from raw phone strings such as `0383 365226`
- every counted phone-like identity attempt in the corpus failed

Why it matters:

- this proves that phone-as-free-form-identity-seed was historically a bad design
- it wasted cycles and added noise without improving recovery

Practical conclusion:

- phone should be used only as exact structured evidence, not as free-form entity discovery

### 6. DDG and free-search lanes were brittle under pressure

Counts:

- `DDG_BLOCK_DETECTED`: `748`
- `DDG_EXHAUSTED_RETRIES`: `511`
- `DDG_BLOCK_ERROR`: `254`
- `DDG_ANTIBOT_GATE`: `89`
- `CAPTCHA`: `28`

Representative symptoms:

- `Blocked by anti-bot gate`
- `DDG_BLOCK`
- `Exhausted retries for query`

Why it matters:

- the historical logs do not support free-search-first architecture as a reliable backbone
- free-search paths were usable only opportunistically, not as the main system of record

### 7. Deep verification often failed on runtime issues, not business mismatch

Counts:

- `DEEPVERIFY_NAVIGATION_FAILED`: `68`
- `DEEPVERIFY_ERR_BLOCKED_BY_CLIENT`: `23`
- `PARKED_DOMAIN`: `18`

Why it matters:

- some candidates were rejected because the verification environment was brittle
- not every failure represented a truly wrong candidate

Practical conclusion:

- the system historically mixed genuine mismatch and runtime-induced rejection

## Validation CSV Findings

Validation artifacts across `output/bulletproof` and `output_server/bulletproof`:

- `found_valid`: `528`
- `found_invalid`: `860`
- `not_found`: `6,242`

This is extremely important:

- the system historically produced more validated false positives than validated true positives in these bulletproof samples

### Invalid patterns

Top invalid discovery methods:

- `hyper_guesser`: `470`
- `pre_existing`: `347`
- `duckduckgo`: `20`
- `paginegialle_phone`: `12`

Top invalid reasons:

- `strong name match, domain match`: `550`
- `strong name match, domain match, foreign language`: `61`
- `strong name match, city match, domain match`: `60`
- `strong name match, address match, domain match`: `49`

Meaning:

- weak semantic and lexical similarity created a large false-positive regime
- name/domain similarity alone was historically unsafe

### Valid patterns

Top valid discovery methods:

- `hyper_guesser`: `306`
- `duckduckgo_search`: `87`
- `hyper_guess`: `43`
- `pre_existing`: `35`
- `duckduckgo`: `23`
- `paginegialle_phone`: `22`

Top valid reasons:

- `PIVA Match`: `130`
- `phone match, strong name match, domain match`: `98`
- `phone match, strong name match, city match, address match, domain match`: `77`
- `phone match, strong name match, address match, domain match`: `59`
- `VAT match`: `51`

Meaning:

- robust success came from hard evidence:
  - VAT/P.IVA
  - exact phone
  - geographic consistency
- not from loose semantic similarity

### Not-found patterns

Top terminal not-found modes:

- `waves_exhausted`: `3,681`
- `fast_exhausted`: `1,520`
- `deep_exhausted`: `557`

Meaning:

- most failures were not cleanly classified
- the system often simply exhausted search depth rather than proving absence

## Scraping and Generation Findings

### Lombardia generation log

Counts from `output_server/generation_lombardia.log`:

- `OVERFLOW_SPLIT`: `26`
- `MAPS_NO_RESULTS_FEED`: `11`
- `PG_PAGE1_EMPTY`: `8`
- `ZERO_RESULTS_PARSED`: `1`

Meaning:

- municipality splitting was necessary and frequent
- some queries degraded into no-results-feed or empty-page behavior
- the scraper already showed signs that broad province/category targets needed adaptive decomposition

### Treviso scraper E2E logs

Counts across the historical scraper logs:

- `NO_PROXIES_DIRECT`: `5`
- `MAPS_INVALID_AUTH_CREDENTIALS`: `4`
- `MAPS_JS_WORLD_PROTOCOL_ERROR`: `5`
- missing `OPENAI_API_KEY`: `7`
- missing `GOOGLE_STREET_VIEW_KEY`: `7`
- missing `ANTIGRAVITY_URL`: `7`

Meaning:

- scraping historically ran under partially degraded environment configuration
- Google Maps scraping also suffered direct runtime issues:
  - auth credential failures
  - JS world/protocol extraction errors

## Ranked Problem List

By operational impact, the main historical problems were:

1. Browser launch and browser health failures.
2. Jina verification/search instability.
3. LLM rate limits, null responses, and fallback collapse.
4. GhostHunter 429 saturation.
5. Weak identity resolution, especially when seeded by raw phone.
6. Free-search/DDG anti-bot fragility.
7. Over-acceptance of weak similarity signals, causing false positives.
8. Exhaustion-based terminal states instead of evidence-based classification.
9. Partial environment degradation during scraping and enrichment.
10. Search target overflow and empty-result handling in scraping.

## What Historically Hurt Accuracy Most

The biggest accuracy killers were:

1. Accepting candidates on weak semantic similarity.
2. Treating noisy discovery lanes as if they were authoritative.
3. Letting runtime/browser instability masquerade as candidate invalidity.
4. Mixing official-site discovery with directory/legal-identity discovery.

## What Historically Hurt Throughput Most

The biggest throughput killers were:

1. Browser launch failure loops.
2. Jina non-200 and insufficient content loops.
3. GhostHunter 429 saturation.
4. LLM rate-limit cascades.
5. DDG block/retry behavior.

## Strategic Implications

The historical logs imply the following constraints:

1. Deterministic lanes must do more work before browser or LLM escalation.
2. Official-site verification must require hard evidence, not just name/domain similarity.
3. Phone must be used as exact verification evidence, not as raw identity discovery.
4. Directory/entity pages must be classified separately from official websites.
5. Search and verification infrastructure must be resilient before concurrency is increased.
6. Exhaustion states need better reason-code granularity.

## Bottom Line

The historical corpus does not describe one broken subsystem.

It describes a repeated pattern:

- weak search infrastructure
- fragile browser runtime
- noisy identity resolution
- expensive rescue logic
- permissive acceptance heuristics

That combination produced both:

- too many false negatives through exhaustion and runtime collapse
- too many false positives through weak validation

The safest interpretation is:

- the historical system was not failing because the web was impossible to resolve
- it was failing because routing, infrastructure, and evidence thresholds were misaligned

That is the core lesson from the full log history.
