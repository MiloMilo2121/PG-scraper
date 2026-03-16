# Enrichment Bulletproof Research

Date: 2026-03-16
Run analyzed: `lombardia_manifattura_existingcsv_r6clean_20260316_093128`
Branch baseline: `codex/lombardia-e2e-preflight-fix`

## Executive summary

The system does not have one dominant bug. It has five interacting failure families:

1. Input signal loss or weak exploitation of existing signals.
2. External discovery provider fragility.
3. Verification policy that is too binary for this dataset.
4. Runtime orchestration issues around workers, browser contexts, Oracle, and throttling.
5. Control-plane and persistence limits that make the system harder to steer safely.

The most important conclusion is this:

- `90%+ official site verified` is still not a realistic fully automatic target on this dataset.
- `90%+ web identity resolved` is realistic if the system allows multiple terminal states, stronger deterministic lanes, and provider-grade discovery.
- The practical target for the next architecture should be:
  - `90%+ web identity resolved`
  - `60-70% official site verified`
  - `0% stealthless runs`
  - `0 OOM`
  - stable RAM target `75-82%` with headroom for spikes

## Current situation

### Dataset facts

- Total companies: `13,594`
- Companies with website in input: `6,972`
- Companies with no website: `5,803`
- Companies with WhatsApp-only website: `819`
- Companies with email: `0`
- Companies with phone: `13,165`

### Latest-state facts from the live run

Latest state means the most recent `job_log` row per company.

- Processed companies: `10,627`
- `FOUND_COMPLETE`: `2,757`
- `NOT_FOUND`: `7,374`
- `DISCOVERY_EXHAUSTED_BLEEDING_MODE`: `291`
- `INPUT_WEBSITE_NOT_VERIFIED`: `146`
- `INPUT_WEBSITE_MESSAGING_OR_REDIRECT`: `51`
- `DISCOVERY_EXHAUSTED`: `4`
- `INPUT_WEBSITE_TIMEOUT`: `3`
- `INPUT_WEBSITE_DIRECTORY_OR_SOCIAL`: `1`

### Success rates by signal bucket

- `HAS_WEBSITE`: `1,702 / 5,492` found, `30.99%`
- `NO_WEBSITE`: `910 / 4,524` found, `20.11%`
- `WHATSAPP`: `145 / 611` found, `23.73%`

### What harmed the run operationally

- `JINA_API_KEY not set`: `2,613`
- `Oracle task failed`: `1,478`
- `Oracle fallback failed`: `985`
- `CHECK_URL_TIMEOUT`: `593`
- `EMERGENCY MODE ACTIVATED`: `33`
- `THROTTLING:` `232`
- `CAPTCHA on html.duckduckgo.com`: `27`

### What this means

- The dataset is hard because it is phone-rich, email-poor, and website-noisy.
- The runtime is too dependent on fragile fallback paths when deterministic signals fail.
- A large amount of `NOT_FOUND` is not "no digital footprint"; it is "pipeline exhausted before resolution".

## Research-backed constraints

These are the constraints confirmed by primary sources and directly relevant to the architecture choices.

### Queueing and worker model

- BullMQ states that concurrency can be achieved either with a high concurrency factor on a worker or with multiple workers in different Node processes, and explicitly says multiple workers are the recommended setup for robustness and availability.
- BullMQ also says sandboxed processors are the safer pattern when work becomes CPU heavy or risks stalling bookkeeping.
- BullMQ provides both worker-level rate limiting and global queue rate limiting.

Sources:

- [BullMQ concurrency](https://docs.bullmq.io/guide/workers/concurrency)
- [BullMQ sandboxed processors](https://docs.bullmq.io/guide/workers/sandboxed-processors)
- [BullMQ rate limiting](https://docs.bullmq.io/guide/rate-limiting)
- [BullMQ global rate limit](https://docs.bullmq.io/guide/queues/global-rate-limit)

### Browser orchestration

- Playwright browser contexts are isolated and cheap to create.
- Playwright recommends reusing `storageState` when you want to reuse authenticated state.
- Playwright exposes multiple pages per context, but isolation is fundamentally context-based.
- Playwright also recommends closing contexts cleanly before closing the browser.

Sources:

- [Playwright browser contexts](https://playwright.dev/docs/browser-contexts)
- [Playwright authentication and storageState](https://playwright.dev/docs/auth)
- [Playwright BrowserContext API](https://playwright.dev/docs/api/class-browsercontext)
- [Playwright Browser API](https://playwright.dev/docs/api/class-browser)

### SQLite concurrency

- SQLite WAL supports concurrent readers and a single writer.
- WAL checkpoints can starve if readers overlap continuously.
- `busy_timeout` helps waiting on locks, but it does not remove the single-writer model.

Sources:

- [SQLite WAL](https://sqlite.org/wal.html)
- [SQLite isolation](https://sqlite.org/isolation.html)
- [SQLite busy_timeout](https://www.sqlite.org/c3ref/busy_timeout.html)

### Search-provider constraints

- Jina public search page says unauthenticated usage is heavily rate limited and points users to an API key for higher limits.
- Google has an official Programmable Search JSON API.
- Serper exposes Google SERP results with API semantics and published rate/price characteristics on its official site.

Sources:

- [Jina Search](https://search.jina.ai/)
- [Google Programmable Search JSON API](https://developers.google.com/custom-search/v1/introduction)
- [Google Programmable Search JSON reference](https://developers.google.com/custom-search/docs/json_api_reference)
- [Serper official site](https://serper.dev/)

## Problem family 1: Input signal quality and lane ordering

This family is about signals already present in the dataset and how early or late they are used.

### 20 solution options

1. Keep `Input Website Lane` first. Impact: very high. Effort: low. Verdict: must do.
2. Canonicalize input website aggressively: strip query/hash, lowercase host, try root and path variants. Impact: high. Effort: low. Verdict: must do.
3. Reject messaging/social/directory URLs before discovery. Impact: medium. Effort: low. Verdict: must do.
4. Use longer verification timeouts for trusted input websites than for weak SERP hits. Impact: high. Effort: low. Verdict: must do.
5. Add `Phone Lane` before SERP when phone exists and official website is not yet verified. Impact: very high. Effort: medium. Verdict: must do.
6. Use direct `pg_url` if scraped and not a search page. Impact: high. Effort: low. Verdict: must do.
7. Add exact address search lane for `address + city`. Impact: medium-high. Effort: medium. Verdict: should do.
8. Normalize VAT/P.IVA at ingest and propagate it to every lane. Impact: high. Effort: low. Verdict: must do.
9. Treat province as a first-class discriminator in query building, not optional noise. Impact: medium. Effort: low. Verdict: should do.
10. Expand company name variants with legal suffix removal, acronym variants, and token compaction. Impact: medium-high. Effort: medium. Verdict: should do.
11. Build a per-company deterministic signal bundle: `name`, `city`, `province`, `phone`, `vat`, `website`. Impact: high. Effort: medium. Verdict: must do.
12. Use phone match as a verification booster on contact pages. Impact: high. Effort: medium. Verdict: must do.
13. Use address match as a verification booster on contact pages. Impact: high. Effort: medium. Verdict: should do.
14. Extract and trust Organization JSON-LD from candidate sites. Impact: high. Effort: medium. Verdict: should do.
15. Try path-stripping rescue for input websites: `/contatti`, `/chi-siamo`, `/azienda` -> root. Impact: medium. Effort: low. Verdict: should do.
16. Salvage domains from corporate email when available in future datasets. Impact: medium. Effort: low. Verdict: should do.
17. Add a domain junk classifier for parked, expired, under-construction, reseller, and marketplace pages. Impact: medium-high. Effort: medium. Verdict: should do.
18. Store provenance per field so later lanes know whether a signal came from CSV, PG, site, or provider. Impact: medium. Effort: medium. Verdict: should do.
19. Pre-score companies by signal richness and choose the cheapest lane order dynamically. Impact: high. Effort: medium. Verdict: should do.
20. Split terminal states into `OFFICIAL_SITE_VERIFIED`, `OFFICIAL_SITE_PROBABLE`, `DIRECTORY_VERIFIED`, `NO_WEB_IDENTITY`. Impact: very high. Effort: medium. Verdict: must do.

### Best subset for this family

- `1, 2, 4, 5, 8, 12, 13, 14, 20`

## Problem family 2: External discovery provider fragility

This family is about the dependence on weak or blocked providers and the lack of hard provider policy.

### 20 solution options

1. Provision `JINA_API_KEY` or remove Jina from the hot path until it is funded. Impact: very high. Effort: low. Verdict: must do.
2. Make `SERPER` the default provider for company search, not only optional lanes. Impact: very high. Effort: medium. Verdict: must do.
3. Add Google Programmable Search JSON API as an official fallback provider. Impact: high. Effort: medium. Verdict: should do.
4. Move Brave/Bing ahead of DDG when DDG block score is hot. Impact: medium-high. Effort: low. Verdict: should do.
5. Maintain live provider health scores and skip unhealthy providers early. Impact: high. Effort: medium. Verdict: must do.
6. Add query-result caching keyed by normalized query and locale. Impact: medium-high. Effort: medium. Verdict: should do.
7. Deduplicate query execution across companies with the same normalized query. Impact: medium. Effort: medium. Verdict: should do.
8. Add per-company search budget caps so weak cases do not explode cost. Impact: high. Effort: low. Verdict: must do.
9. Add per-provider and per-host cooldown windows after blocks or 429s. Impact: high. Effort: medium. Verdict: must do.
10. Use phone-driven PG rescue before generic web search when phone exists. Impact: very high. Effort: medium. Verdict: must do.
11. Add exact address reverse search as a provider-neutral deterministic lane. Impact: medium. Effort: medium. Verdict: should do.
12. Use registry/official-business sources only when VAT or exact legal name is present. Impact: medium-high. Effort: medium. Verdict: should do.
13. Demote MX and CRT-based discovery to booster-only roles, not early discovery drivers. Impact: medium. Effort: low. Verdict: should do.
14. Turn off DDG entirely for a cooldown window after CAPTCHA spikes. Impact: medium-high. Effort: low. Verdict: must do.
15. Use BullMQ manual rate limiting when providers return block signals. Impact: high. Effort: medium. Verdict: must do.
16. Split discovery into distinct provider classes: deterministic, paid SERP, scraped SERP, AI fallback. Impact: high. Effort: medium. Verdict: must do.
17. Run expensive providers only on companies with enough signal richness. Impact: high. Effort: low. Verdict: must do.
18. Persist provider-specific failure reason codes into job state. Impact: medium-high. Effort: medium. Verdict: should do.
19. Maintain feature flags per provider so broken paths can be cut without deploys. Impact: high. Effort: low. Verdict: must do.
20. Define explicit provider SLOs: latency, block rate, success contribution, marginal cost. Impact: medium-high. Effort: medium. Verdict: should do.

### Best subset for this family

- `1, 2, 4, 5, 8, 9, 10, 14, 15, 16, 19`

## Problem family 3: Verification policy and candidate acceptance

This family is about how the system decides that a candidate site is official enough.

### 20 solution options

1. Use timeout by source confidence: input website > registry extract > SERP > weak AI guess. Impact: high. Effort: low. Verdict: must do.
2. Verify the top `2-3` candidates in parallel and cancel on first strong match. Impact: high. Effort: medium. Verdict: must do.
3. Add `phone`, `address`, and `city` to verification evidence, not just VAT and semantic name. Impact: very high. Effort: medium. Verdict: must do.
4. Treat directory pages as identity evidence, not as accidental false positives. Impact: high. Effort: medium. Verdict: must do.
5. Add `OFFICIAL_SITE_PROBABLE` as a terminal state. Impact: high. Effort: medium. Verdict: must do.
6. Add `DIRECTORY_VERIFIED` as a terminal state. Impact: high. Effort: medium. Verdict: must do.
7. Extract Organization JSON-LD and contact metadata before declaring failure. Impact: high. Effort: medium. Verdict: should do.
8. Deep-check `/contatti`, `/privacy`, `/chi-siamo`, `/azienda`, `/impressum` when homepage is weak. Impact: medium-high. Effort: low. Verdict: should do.
9. Score final URL after redirects, not just requested URL. Impact: medium. Effort: low. Verdict: must do.
10. Penalize marketplaces, review sites, and social pages explicitly in acceptance. Impact: medium-high. Effort: low. Verdict: must do.
11. Use RDAP/WHOIS only as a booster, never as sole proof. Impact: medium. Effort: low. Verdict: should do.
12. Keep a "best loser" state, but persist it distinctly for rescue passes. Impact: medium. Effort: low. Verdict: should do.
13. Retry verification on slow but promising sites with a slower lane instead of immediate rejection. Impact: medium-high. Effort: medium. Verdict: should do.
14. Add structured `reason_code` values for every rejection reason. Impact: very high. Effort: low. Verdict: must do.
15. Store machine-readable verification evidence per decision. Impact: high. Effort: medium. Verdict: should do.
16. Calibrate thresholds against a labeled holdout set of 200-500 companies. Impact: very high. Effort: medium. Verdict: must do.
17. Allow a "verified directory with extracted official website" terminal path. Impact: high. Effort: medium. Verdict: should do.
18. Add language and location matching as weak positive features. Impact: medium. Effort: low. Verdict: maybe.
19. Use a verifier ensemble: deterministic first, LLM only as tie-breaker. Impact: high. Effort: medium. Verdict: must do.
20. Separate "cannot verify" from "searched and no web identity exists". Impact: very high. Effort: medium. Verdict: must do.

### Best subset for this family

- `1, 2, 3, 4, 5, 6, 9, 10, 14, 16, 19, 20`

## Problem family 4: Runtime concurrency, browser, Oracle, and anti-block control

This family is about keeping the machine fast without making the run self-destructive.

### 20 solution options

1. Keep multiple worker processes, because BullMQ itself recommends multi-worker setups for robustness. Impact: high. Effort: low. Verdict: must do.
2. Separate Node queue workers from browser-heavy workers. Impact: high. Effort: medium. Verdict: should do.
3. Use BullMQ global rate limiting to prevent unbounded pickup when providers are stressed. Impact: high. Effort: medium. Verdict: must do.
4. Add per-host rate limiting on search and verification targets. Impact: very high. Effort: medium. Verdict: must do.
5. Keep RAM target at `75-82%`, not higher. Impact: high. Effort: low. Verdict: must do.
6. Reserve hard headroom of `15-20%` RAM for browser spikes. Impact: high. Effort: low. Verdict: must do.
7. Scale by measured browser RSS, not only by worker counts. Impact: high. Effort: medium. Verdict: should do.
8. Put Oracle behind an explicit health gate so workers refuse to start without stealth. Impact: very high. Effort: done. Verdict: must do.
9. Create a separate slow lane queue for Oracle escalations. Impact: high. Effort: medium. Verdict: should do.
10. Recycle browser contexts on error classes, not only request count. Impact: high. Effort: medium. Verdict: should do.
11. Prewarm a small number of contexts per hot host family. Impact: medium. Effort: medium. Verdict: maybe.
12. Persist and reuse storage state per host family carefully, not globally. Impact: medium-high. Effort: medium. Verdict: should do.
13. Use multiple pages per context only for same-host burst scenarios, not as a general replacement for context isolation. Impact: medium. Effort: medium. Verdict: maybe.
14. Split browser pool supervision out of `MasterPipeline` so browser crashes do not poison queue state. Impact: high. Effort: high. Verdict: should do.
15. Add host-based circuit breakers for block-heavy domains like DDG. Impact: high. Effort: medium. Verdict: must do.
16. Replace punitive-only backpressure with source-aware throttling. Impact: high. Effort: medium. Verdict: must do.
17. Pause queues globally on Oracle outage, not just locally. Impact: high. Effort: medium. Verdict: should do.
18. Use sandboxed processors only for truly CPU-heavy transforms, not as a reflex. Impact: low-medium. Effort: medium. Verdict: maybe.
19. Persist live runtime state: current worker count, pool pressure, hot hosts, Oracle health. Impact: medium-high. Effort: medium. Verdict: should do.
20. Add restart-safe worker deployment scripts that replace old worker PIDs cleanly. Impact: high. Effort: low. Verdict: must do.

### Best subset for this family

- `1, 3, 4, 5, 6, 8, 9, 10, 15, 16, 20`

## Problem family 5: Persistence, observability, and control plane

This family is about making the run measurable and steerable, not just faster.

### 20 solution options

1. Create a `company_latest_state` table so analytics do not depend on `max(id)` scans. Impact: high. Effort: medium. Verdict: should do.
2. Use a single DB writer process or queue to reduce SQLite writer contention. Impact: high. Effort: medium. Verdict: should do.
3. Batch writes where possible instead of one write-heavy path per job. Impact: medium-high. Effort: medium. Verdict: should do.
4. Keep read transactions short and explicit. Impact: medium. Effort: low. Verdict: must do.
5. Add manual WAL checkpoints on run milestones or quiet windows. Impact: medium-high. Effort: medium. Verdict: should do.
6. Monitor WAL size and checkpoint lag. Impact: medium-high. Effort: low. Verdict: should do.
7. Ensure `busy_timeout` is consistently applied on every connection and process. Impact: medium. Effort: low. Verdict: should do.
8. If throughput grows beyond SQLite comfort, migrate hot-path run logging to Postgres. Impact: high. Effort: high. Verdict: later.
9. Make `reason_code` mandatory and richer than `status`. Impact: very high. Effort: low. Verdict: must do.
10. Store per-stage durations in machine-readable form. Impact: high. Effort: medium. Verdict: should do.
11. Store provider contribution metrics: attempts, success, block rate, latency. Impact: high. Effort: medium. Verdict: must do.
12. Persist verification evidence so later audit does not rely on log grep. Impact: high. Effort: medium. Verdict: should do.
13. Add run-level cohorts by signal bucket: website/no website/phone/PG/url type. Impact: high. Effort: low. Verdict: must do.
14. Create a labeled benchmark set for regression testing. Impact: very high. Effort: medium. Verdict: must do.
15. Add replay tooling for failed cohorts with a modified lane order. Impact: high. Effort: medium. Verdict: should do.
16. Add shadow A/B execution for 1-5% of jobs before major architecture flips. Impact: medium-high. Effort: medium. Verdict: should do.
17. Persist configuration snapshot per run. Impact: high. Effort: low. Verdict: must do.
18. Add stop/go gates before production runs: Oracle health, API keys, disk, RAM headroom. Impact: very high. Effort: low. Verdict: must do.
19. Add "run doctor" diagnostics that summarize likely causes of low enrichment in one command. Impact: medium-high. Effort: medium. Verdict: should do.
20. Keep a strict distinction between business success and technical success in dashboards. Impact: very high. Effort: low. Verdict: must do.

### Best subset for this family

- `1, 2, 5, 9, 11, 13, 14, 17, 18, 20`

## Final point on the situation

The run is not failing because "Lombardia manufacturing has no web presence". That explanation is false.

The real situation is:

- many companies do have some web identity,
- the dataset is sparse on email but rich on phone,
- the system spends too much time proving negatives through weak providers,
- the runtime still falls into fragile fallback paths too early,
- and the outcome model is still too binary.

The biggest missing strategic move is this:

- stop treating `website discovery` and `web identity resolution` as the same problem.

Those are two different goals:

- `web identity resolved`: official site, probable site, or trusted directory page.
- `official site verified`: the strongest subset.

If the system continues to optimize only for the second goal with binary statuses, it will keep undercounting wins and overpaying for hard cases.

## Bulletproof plan

### Phase 0: No more self-sabotage

Target: 1-2 days

1. Require Oracle stealth health before any enrichment run starts.
2. Enable or remove `JINA` from the hot path.
3. Add phone-first rescue before generic SERP when phone exists.
4. Add per-host rate limiting and DDG cooldown.
5. Keep worker fleet at a conservative RAM target.
6. Make reason codes and config snapshots mandatory.

### Phase 1: Raise deterministic coverage

Target: 3-5 days

1. Finish deterministic lane order:
   input website -> pg_url -> phone rescue -> address rescue -> paid SERP -> scraped SERP -> Oracle
2. Add verification evidence for phone, address, and JSON-LD.
3. Add multi-state outcomes:
   `OFFICIAL_SITE_VERIFIED`, `OFFICIAL_SITE_PROBABLE`, `DIRECTORY_VERIFIED`, `NO_WEB_IDENTITY`
4. Add replay tooling for failed cohorts.

### Phase 2: Make runtime resilient

Target: 5-7 days

1. Split fast lane and slow lane workers.
2. Add provider health scoring and automatic provider demotion.
3. Add Oracle slow-lane queue.
4. Improve browser recycle policy and host-based storage state reuse.
5. Add run doctor and live SLO dashboard.

### Phase 3: Scale without losing truth

Target: 1-2 weeks

1. Introduce `company_latest_state`.
2. Consider single-writer queue or Postgres migration for hot-path logging if SQLite starts to pinch.
3. Build a labeled benchmark set and shadow A/B path.
4. Calibrate thresholds against real outcomes, not gut feel.

## Recommended target architecture

`Signal Router`

- Classify every company into one of:
  - `RICH_SIGNALS`
  - `PHONE_ONLY`
  - `WEBSITE_ONLY`
  - `SPARSE`

`Lane order`

- `RICH_SIGNALS`: input website -> phone rescue -> verification ensemble -> paid SERP only if needed
- `PHONE_ONLY`: phone rescue -> PG/directories -> paid SERP -> slow verification
- `WEBSITE_ONLY`: input website lane -> verification ensemble -> paid SERP
- `SPARSE`: paid SERP -> directory identity -> Oracle slow lane

`Terminal states`

- `OFFICIAL_SITE_VERIFIED`
- `OFFICIAL_SITE_PROBABLE`
- `DIRECTORY_VERIFIED`
- `NO_WEB_IDENTITY`
- `RUN_BLOCKED_ENVIRONMENT`

`Control plane`

- provider health
- global queue rate limit
- per-host limiter
- Oracle health gate
- RAM target scaler
- explicit stop/go preflight

## What I would do next, concretely

In strict priority order:

1. Implement `Phone Lane` before generic SERP.
2. Make `SERPER` the default company-search provider and either fund `JINA` or cut it.
3. Add multi-state terminal outcomes.
4. Add per-host/global rate limiting.
5. Add provider and verification evidence metrics.

That is the shortest path to a system that is both faster and much harder to fool.
