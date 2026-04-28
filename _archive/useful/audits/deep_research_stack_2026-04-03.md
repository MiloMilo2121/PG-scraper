# Deep Research Stack Update

Date: 2026-04-03

## Goal

Identify the highest-leverage stack updates for PG3 across:

- website discovery
- extraction and validation
- financial and decision-maker enrichment
- low-cost/high-utility LLM routing

This note prioritizes official docs, live provider catalogs, and active GitHub repos.

## Validated stack decisions

### Discovery backbone

1. Keep `PG/phone/entity` as the deterministic first lane.
2. Keep `Oracle` as a hard-target / WAF recovery lane, not the only backbone.
3. Promote `Serper` as the default paid SERP lane.
4. Add `Exa` for ambiguous company/entity/person research.
5. Use `Firecrawl` after URL discovery for extraction, not as the primary search engine.

### LLM routing

OpenRouter is worth integrating as a real provider, but as an LLM layer, not as a search backbone.

Default recommendations as of today:

- `openai/gpt-5-nano`
  - best cheap structured-output + tools default
- `google/gemini-2.5-flash-lite`
  - cheap long-context fallback with tools/structured outputs
- `z-ai/glm-4.7-flash`
  - cheap general-purpose fallback
- `qwen/qwen3.6-plus:free`
  - useful experimental/free lane, not the main production default

## Live OpenRouter catalog takeaways

Source: `https://openrouter.ai/api/v1/models`

Observed on 2026-04-03:

- `qwen/qwen3.6-plus:free`
  - `tools=true`
  - `structured_outputs=true`
  - `context=1000000`
- `openai/gpt-5-nano`
  - `tools=true`
  - `structured_outputs=true`
  - cheap enough to be a practical production default
- `google/gemini-2.5-flash-lite`
  - `tools=true`
  - `structured_outputs=true`
  - large context window
- `z-ai/glm-4.7-flash`
  - `tools=true`
  - `structured_outputs=true`
- `openai/gpt-oss-20b`
  - `tools=true`
  - `structured_outputs=true`

Interpretation:

- free models are now viable for experiments and non-critical fallbacks
- the best production cheap default remains a model with reliable structured outputs and tool support
- `gpt-5-nano` is the safest cheap default among the currently exposed OpenRouter options

## GitHub repo scan

Maintenance signals checked:

- stars
- latest push
- latest releases

### Highest-signal repos

1. `firecrawl/firecrawl`
   - stars: `103k+`
   - pushed: `2026-04-03`
   - why it matters:
     - strong fit for extraction from known URLs
     - useful for contacts, privacy/legal pages, structured site extraction
   - verdict:
     - integrate as a fetch/extract lane

2. `unclecode/crawl4ai`
   - stars: `63k+`
   - pushed: `2026-03-31`
   - releases include `v0.8.5` on `2026-03-18`
   - why it matters:
     - good ideas for LLM-friendly crawl and extraction
   - verdict:
     - borrow ideas and patterns, do not replace the current runtime wholesale

3. `browser-use/browser-use`
   - stars: `85k+`
   - pushed: `2026-04-03`
   - releases include `0.12.6` on `2026-04-02`
   - why it matters:
     - strong agent/browser task execution patterns
   - verdict:
     - borrow orchestration ideas; avoid turning PG3 into a browser-agent product

4. `browserbase/stagehand`
   - stars: `21k+`
   - pushed: `2026-04-03`
   - releases include `stagehand/server-v3 v3.6.3` on `2026-03-31`
   - why it matters:
     - good selector/action abstractions
   - verdict:
     - borrow patterns for robust interaction and page understanding

5. `apify/crawlee`
   - stars: `22k+`
   - pushed: `2026-04-01`
   - releases include `v3.16.0` on `2026-02-06`
   - why it matters:
     - mature queue/proxy/session crawling patterns
   - verdict:
     - borrow queue/session ideas, especially host-level throttling and crawl ergonomics

6. `microsoft/playwright`
   - stars: `85k+`
   - pushed: `2026-04-03`
   - releases include `v1.59.1` on `2026-04-01`
   - why it matters:
     - still the browser automation foundation to keep
   - verdict:
     - keep as the browser substrate; do not replace

## Operational implications for PG3

### Do now

- integrate `Serper`, `Exa`, `Firecrawl`, `OpenRouter` as first-class runtime lanes
- skip providers with missing credentials before execution
- add cooldowns for punitive provider failures
- keep deterministic `PG/phone` lanes ahead of generic web discovery

### Do next

- use `Firecrawl` for contact/privacy/legal extraction
- upgrade `decision_maker_stage` to multi-source discovery using `Serper + Exa + website signals`
- upgrade financial discovery to a multi-lane subsystem instead of snippet-only heuristics

### Do not do

- do not replace the whole stack with a browser agent framework
- do not use OpenRouter as the primary search backbone
- do not trust free-search-first flows on hard datasets

## Sources

- OpenRouter model catalog: `https://openrouter.ai/api/v1/models`
- OpenRouter web search docs: `https://openrouter.ai/docs/guides/features/plugins/web-search`
- Exa Search API docs: `https://docs.exa.ai/reference/search`
- Firecrawl Extract docs: `https://docs.firecrawl.dev/features/extract`
- Firecrawl Search docs: `https://docs.firecrawl.dev/features/search`
- GitHub repos:
  - `https://github.com/firecrawl/firecrawl`
  - `https://github.com/unclecode/crawl4ai`
  - `https://github.com/browser-use/browser-use`
  - `https://github.com/browserbase/stagehand`
  - `https://github.com/apify/crawlee`
  - `https://github.com/microsoft/playwright`
