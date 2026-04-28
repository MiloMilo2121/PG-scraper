# Enrichment Tools Landscape

Date: 2026-03-16
Objective: identify external providers, repos, SDKs, and integrations that can materially improve enrichment rate toward `90%+ web identity resolved` and maximize the chance of materially increasing `official site verified`.

## Bottom line

There is no single plugin or repo that gets the system to `90%+ official site verified`.

What can get us there for `web identity resolved` is a layered stack:

1. deterministic lanes first,
2. strong paid search providers second,
3. reliable browser/crawling infrastructure third,
4. structured extraction and validation fourth,
5. strict provider policy and runtime control around all of it.

The best practical tool stack is not "more stealth". It is:

- stronger search APIs,
- stronger phone/address/entity resolution,
- stronger structured extraction,
- stronger runtime control.

## Selection criteria

Every candidate below is judged on:

- likely impact on enrichment rate
- fit with current TS/Node + Playwright + BullMQ architecture
- operational complexity
- cost control
- reliability / independence
- whether it helps `official site verified` or only `web identity resolved`

## Category A: Search APIs and discovery providers

### 1. Serper

What it is:

- Google-backed SERP API wrapper with structured web results.

Why it matters:

- It is the cleanest immediate upgrade for company search.
- It should become the default company-search provider before DDG.

How to use it here:

- Make it the default in `SERP_PROVIDER_ORDER`.
- Use it for all `company`, `registry`, and `phone + company` discovery queries.

Verdict:

- `Must adopt harder than today`.

Sources:

- [Serper](https://serper.dev/)

### 2. Brave Search API

What it is:

- Official Brave search API with its own index.

Why it matters:

- Independent index.
- Good complement to Google-derived APIs.
- Structured results, metadata, and reranking controls.

How to use it here:

- Insert ahead of DDG.
- Use as secondary provider after Serper.

Verdict:

- `Strong candidate`.

Sources:

- [Brave Search API](https://brave.com/search/api/)

### 3. Google Programmable Search JSON API

What it is:

- Official Google search API.

Why it matters:

- Official and stable.
- Good for deterministic business lookup where SERPER alone is not enough.

How to use it here:

- Add as a premium fallback for exact `company + city + province`.

Verdict:

- `Strong candidate`.

Sources:

- [Google Programmable Search JSON API intro](https://developers.google.com/custom-search/v1/introduction)
- [Google Programmable Search JSON API reference](https://developers.google.com/custom-search/docs/json_api_reference)

### 4. Google Places Text Search / Place Details

What it is:

- Official Google Maps/Places API.

Why it matters:

- This is probably the single most important external addition after better web search.
- Dataset is phone-rich and address-rich.
- Google Places is excellent for phone and address driven entity resolution.

How to use it here:

- Add a `Phone Lane`:
  - `phone -> place search`
  - `company + address -> place search`
- Pull `websiteUri`, `displayName`, `formattedAddress`, `nationalPhoneNumber`, `businessStatus`.

Verdict:

- `Top-priority addition`.

Sources:

- [Places API Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search)

### 5. OpenCorporates API

What it is:

- Corporate entity registry API.

Why it matters:

- Good for legal-name and company-number resolution.
- Helps move uncertain results into verified legal identity states.

How to use it here:

- Use after P.IVA or strong legal-name match.
- Store company-number / jurisdiction / official entity page as evidence.

Verdict:

- `Strong candidate for validation and directory-verified states`.

Sources:

- [OpenCorporates API](https://api.opencorporates.com/)
- [OpenCorporates API Reference](https://api.opencorporates.com/v0.3/documentation/API-Reference)
- [OpenCorporates reconciliation API docs](https://api.opencorporates.com/documentation/Open-Refine-Reconciliation-API)

### 6. Exa Search API

What it is:

- Independent API search engine with content extraction.

Why it matters:

- Promising for agentic search and richer results than thin SERP wrappers.
- Could be valuable for hard-tail research cases.

How to use it here:

- Keep it out of the hot path initially.
- Test only as deep-search fallback on hard cohorts.

Verdict:

- `Good experiment, not first rollout`.

Sources:

- [Exa Search API reference](https://exa.ai/docs/reference/search)
- [Exa 2.0](https://exa.ai/blog/exa-api-2-0)
- [Exa 2.1](https://exa.ai/blog/exa-api-2-1)

### 7. Tavily

What it is:

- Search + extract + crawl platform oriented to agent workflows.

Why it matters:

- Strong for fast web-grounding and content extraction in one API.

How to use it here:

- Evaluate only if we want search plus content extraction in one provider.
- Could replace some weak SERP + scrape combos.

Verdict:

- `Worth testing, not mandatory`.

Sources:

- [Tavily product](https://www.tavily.com/product)
- [Tavily search endpoint](https://docs.tavily.com/documentation/api-reference/endpoint/search)

### 8. DataForSEO SERP API

What it is:

- Industrial SEO/SEM SERP data provider.

Why it matters:

- More enterprise-oriented than cheap wrappers.
- Useful if we want deep location/language SERP coverage with SLA.

How to use it here:

- Consider if Serper + Brave are still not stable enough at scale.

Verdict:

- `Enterprise fallback option`.

Sources:

- [DataForSEO APIs](https://dataforseo.com/apis)

### 9. Common Crawl Index

What it is:

- Historical crawl index of the public web.

Why it matters:

- Not for the hot path.
- Useful for rescue or historical domain discovery when a company site is down but existed recently.

How to use it here:

- Offline rescue pipeline on `NOT_FOUND` cohort only.

Verdict:

- `Specialized rescue tool`.

Sources:

- [Common Crawl Index Server](https://index.commoncrawl.org/)
- [Common Crawl CDXJ index](https://commoncrawl.org/cdxj-index)

## Category B: Browser/crawling infrastructure

### 10. Crawlee

What it is:

- Large-scale crawling library for Node with autoscaling.

Why it matters:

- This is the clearest off-the-shelf answer to the "use RAM aggressively but safely" requirement.
- `AutoscaledPool` explicitly scales on CPU/memory availability.

How to use it here:

- Either adopt directly for a new discovery worker type, or port its autoscaling logic.

Verdict:

- `Top candidate for runtime redesign`.

Sources:

- [Crawlee docs](https://apify.github.io/apify-ts/)
- [AutoscaledPool](https://apify.github.io/apify-ts/api/core/class/AutoscaledPool)
- [Using proxies with Crawlee](https://docs.apify.com/academy/anti-scraping/mitigation/using-proxies)

### 11. Crawlee Python

What it is:

- Python implementation of Crawlee with state persistence and browser support.

Why it matters:

- Useful if Oracle sidecar evolves into a more complete Python crawl service.

How to use it here:

- Candidate replacement for custom Oracle crawl orchestration.

Verdict:

- `Good sidecar evolution path`.

Sources:

- [crawlee-python repo](https://github.com/apify/crawlee-python)

### 12. Browserless OSS / BaaS

What it is:

- Managed or self-hosted remote browser infrastructure for Playwright/Puppeteer.

Why it matters:

- Offloads browser process management.
- Gives concurrency controls, session management, and health checks.

How to use it here:

- Replace local heavy browser pool for some worker classes.
- Use via `connectOverCDP`.

Verdict:

- `Very strong candidate if browser operations remain the bottleneck`.

Sources:

- [Browserless docs](https://docs.browserless.io/)
- [Browserless BaaS](https://docs.browserless.io/baas/start)
- [Browserless open-source deployment](https://docs.browserless.io/enterprise/open-source)

### 13. Browserbase

What it is:

- Managed browser sessions for Playwright.

Why it matters:

- Similar value to Browserless with strong developer ergonomics.

How to use it here:

- Evaluate as a managed alternative to self-running browser pools.

Verdict:

- `Good commercial option`.

Sources:

- [Browserbase Playwright intro](https://docs.browserbase.com/introduction/playwright)

### 14. Zyte API

What it is:

- Managed extraction, browser automation, and proxy/anti-ban platform.

Why it matters:

- If the system keeps spending too much engineering effort on anti-ban, Zyte is a direct buy-vs-build alternative.

How to use it here:

- Use for hard browser targets or selective extraction.
- Not for everything; it can get expensive.

Verdict:

- `High-value but cost-sensitive`.

Sources:

- [Zyte API usage docs](https://docs.zyte.com/zyte-api/usage/index.html)
- [Zyte docs home](https://docs.zyte.com/)

### 15. scrapy-zyte-api

What it is:

- Official Scrapy integration for Zyte API.

Why it matters:

- Good if we build a dedicated rescue spider or slow-lane crawler.

How to use it here:

- Useful only if we introduce a Scrapy-based worker class.

Verdict:

- `Optional if moving into Scrapy`.

Sources:

- [scrapy-zyte-api migration/setup docs](https://docs.zyte.com/zyte-api/migration/zyte/scrapy-zyte-smartproxy.html)

### 16. Scrapfly SDK

What it is:

- SDK for browser + proxy rotation + extraction.

Why it matters:

- Another buy-vs-build candidate if custom browser infrastructure remains unstable.

How to use it here:

- Evaluate for difficult sites and extraction-heavy paths.

Verdict:

- `Worth benchmarking`.

Sources:

- [scrapfly/python-scrapfly](https://github.com/scrapfly/python-scrapfly)

### 17. Scrapy AutoThrottle

What it is:

- Official adaptive throttling extension for Scrapy.

Why it matters:

- Even if we do not adopt Scrapy, the algorithm is relevant.
- Per-slot/domain adaptive throttling is better than one coarse punitive valve.

How to use it here:

- Borrow the design:
  - per-host slots
  - delay adjusted by latency
  - non-200 responses only increase delay

Verdict:

- `Must borrow conceptually`.

Sources:

- [Scrapy AutoThrottle](https://docs.scrapy.org/en/master/topics/autothrottle.html)

## Category C: Structured extraction, normalization, and semantic evidence

### 18. libpostal

What it is:

- Address normalization and parsing library.

Why it matters:

- Huge fit for this dataset.
- If address normalization becomes strong, address-based matching and Google Places queries become much better.

How to use it here:

- Normalize and tokenize addresses before address search and verification.

Verdict:

- `Top-priority enrichment utility`.

Sources:

- [openvenues/libpostal](https://github.com/openvenues/libpostal)

### 19. pelias/libpostal-service

What it is:

- Dockerized service wrapper around libpostal.

Why it matters:

- Makes libpostal easier to operate as a service instead of a local native dependency.

How to use it here:

- Run beside Oracle or as a separate address-normalization microservice.

Verdict:

- `Best deployment path for libpostal`.

Sources:

- [pelias/libpostal-service](https://github.com/pelias/libpostal-service)

### 20. Schema.org / JSON-LD extraction

What it is:

- Standard structured data vocabulary, often embedded in company sites.

Why it matters:

- A lot of company sites expose `Organization`, `legalName`, `url`, `telephone`, and `address`.
- This is extremely strong verification evidence.

How to use it here:

- Parse JSON-LD on every candidate site before declaring `NOT_FOUND`.

Verdict:

- `Must use harder than today`.

Sources:

- [Schema.org](https://schema.org/)
- [Schema.org Organization](https://schema.org/Organization)

### 21. Trafilatura

What it is:

- Robust text and metadata extraction library.

Why it matters:

- Good for extracting cleaner main text and metadata from pages before semantic validation.

How to use it here:

- Use in a Python sidecar or separate rescue verifier.

Verdict:

- `Strong candidate for rescue verification`.

Sources:

- [trafilatura repo](https://github.com/adbar/trafilatura)

### 22. readability-lxml

What it is:

- Main content extraction library.

Why it matters:

- Simpler than Trafilatura, useful for fallback text extraction.

How to use it here:

- Lightweight extraction fallback for difficult HTML pages.

Verdict:

- `Useful fallback, not core differentiator`.

Sources:

- [readability-lxml repo](https://github.com/predatell/python-readability-lxml)

### 23. Article extraction benchmark

What it is:

- Benchmark repo comparing extraction libraries.

Why it matters:

- Helps choose extraction stack empirically instead of by taste.

How to use it here:

- Use to decide between Trafilatura/readability/custom html cleaner for candidate page extraction.

Verdict:

- `Useful evaluation asset`.

Sources:

- [article-extraction-benchmark](https://github.com/scrapinghub/article-extraction-benchmark)

### 24. OpenAI Structured Outputs

What it is:

- Schema-constrained JSON outputs from the API.

Why it matters:

- Ideal for forcing verification evidence into stable shapes.
- Reduces parser breakage and weird LLM JSON.

How to use it here:

- Use only for tie-breaker / evidence summarization, not for first-pass search.

Verdict:

- `Strong fit for verifier outputs`.

Sources:

- [OpenAI Structured Outputs announcement](https://openai.com/index/introducing-structured-outputs-in-the-api/)
- [OpenAI Responses API response_format](https://platform.openai.com/docs/api-reference/responses/compacted-object)

## Category D: Entity extraction and automation integrations

### 25. scrapy-autoextract

What it is:

- Official Scrapy integration for Zyte AutoExtract.

Why it matters:

- Useful if we decide to outsource structured page extraction.

How to use it here:

- Only for targeted rescue on hard pages.

Verdict:

- `Useful if we adopt Zyte`.

Sources:

- [scrapy-autoextract](https://github.com/scrapinghub/scrapy-autoextract)

### 26. Browserless session management

What it is:

- Remote persistent browser session handling.

Why it matters:

- Directly relevant to our current `BrowserPool` and session-state reuse.

How to use it here:

- Replace local session pool or at least test operational simplicity vs. our custom pool.

Verdict:

- `Strong operational simplifier`.

Sources:

- [Browserless quick start](https://docs.browserless.io/libraries/puppeteer)

### 27. Browserless open-source container

What it is:

- Self-hosted remote browser runtime.

Why it matters:

- Lets us keep browser infra on Hetzner while isolating it from workers.

How to use it here:

- Run Browserless container on the same host or dedicated host.

Verdict:

- `Very plausible migration path from custom BrowserPool`.

Sources:

- [Browserless open-source deployment](https://docs.browserless.io/enterprise/open-source)

### 28. Crawlee proxy rotation patterns

What it is:

- First-class proxy rotation and autoscaled crawling patterns.

Why it matters:

- Current system needs per-host and per-provider control more than raw stealth escalation.

How to use it here:

- Borrow design even if we do not adopt Crawlee wholesale.

Verdict:

- `Architecturally important`.

Sources:

- [Apify/Crawlee proxy rotation guidance](https://docs.apify.com/academy/anti-scraping/mitigation/using-proxies)

## Category E: What to modify internally before adding more providers

External tools alone will not fix the core issues. These internal changes are still mandatory.

### 29. Add `Phone Lane`

Reason:

- `13,165` companies have phone.
- This is the largest missing deterministic signal.

Should use:

- Google Places
- PG phone harvester
- phone evidence in verifier

### 30. Split business outcomes

Reason:

- `FOUND_COMPLETE/NOT_FOUND` is too coarse.

Should become:

- `OFFICIAL_SITE_VERIFIED`
- `OFFICIAL_SITE_PROBABLE`
- `DIRECTORY_VERIFIED`
- `NO_WEB_IDENTITY`

### 31. Add provider health routing

Reason:

- `JINA_API_KEY not set`, DDG CAPTCHA, and Oracle failures prove that static order is too brittle.

Should include:

- provider health score
- host cooldown
- queue/global rate limit

### 32. Add per-host throttling

Reason:

- One global punitive valve is too coarse.

Should borrow from:

- Scrapy AutoThrottle slot logic

### 33. Add evidence-based verifier

Reason:

- Need `phone`, `address`, `JSON-LD`, `legalName`, redirect chain, final URL.

### 34. Add `company_latest_state`

Reason:

- Analytics currently rely too much on scanning `job_log`.

## What I would implement now

If the objective is to maximize actual gain, I would do this exact shortlist:

1. `Google Places API` for phone/address lane.
2. `Serper` as hard default for company search.
3. `Brave Search API` as second provider before DDG.
4. `OpenCorporates API` for legal-entity validation.
5. `libpostal` or `libpostal-service` for address normalization.
6. `Schema.org/JSON-LD extraction` as mandatory verifier evidence.
7. `OpenAI Structured Outputs` only for verifier tie-breaker output formatting.
8. `Crawlee AutoscaledPool` logic or direct adoption for adaptive concurrency.
9. `Browserless` or `Browserbase` if local browser orchestration keeps causing instability.

## What I would test, not adopt immediately

1. `Exa`
2. `Tavily`
3. `DataForSEO`
4. `Zyte API`
5. `Scrapfly`
6. `Trafilatura`
7. `readability-lxml`

These are strong tools, but they are not the shortest path to the next big jump.

## What I would avoid as a first move

1. Adding more weak search fallbacks before fixing lane order.
2. Raising worker count before fixing per-host throttling.
3. Spending more effort on custom stealth tricks before adding phone/address/entity lanes.
4. Optimizing only for `official site verified` without introducing multi-state outcomes.
5. Migrating the entire system to another framework before extracting the good parts we actually need.

## Practical target stack

### Hot path

- input website
- pg_url
- phone lane via Google Places + PG
- address lane via libpostal + Google Places
- Serper
- Brave Search API
- verifier using VAT + phone + address + JSON-LD + legalName

### Slow lane

- OpenCorporates validation
- Browserless or Oracle browser fetch
- Exa / Tavily / DataForSEO experiments
- directory identity resolution

### Runtime

- BullMQ multi-worker
- global queue rate limit
- per-host cooldown
- adaptive concurrency inspired by Crawlee/Scrapy

## Final conclusion

If the only question is "what external things can materially change the outcome?", the best answer is:

- `Google Places API`
- `Serper`
- `Brave Search API`
- `OpenCorporates API`
- `libpostal`
- `Schema.org JSON-LD extraction`
- `Crawlee autoscaling patterns`
- `Browserless` if browser operations remain unstable

That stack is the highest-probability path to a meaningful jump in enrichment quality without turning the system into an unbounded mess of brittle providers.
