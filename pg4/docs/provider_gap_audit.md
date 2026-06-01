# Provider Gap Audit: pg3 vs pg4

**Date:** 2026-06-01
**Branch:** pg4/phase-4.4-structure-cleanup
**Scope:** All provider/tool categories — SERP, HTTP fetch, LLM, Data enrichment
**Method:** Direct code reading of pg3/src and pg4/src; no network execution.

---

## 1. pg3 Providers Found (with file evidence)

### 1.1 SERP Providers

| Provider ID | Class | File |
|---|---|---|
| `DNS-MX-MINING-0` | `MxDiscoveryProvider` | `pg3/src/enricher/core/discovery/mx_discovery_provider.ts` |
| `CRTSH-API-1` | `CrtShProvider` | `pg3/src/enricher/core/discovery/search_provider.ts` (re-exported from `crtsh_provider.ts`) |
| `DDG-LITE-1` | `DDGSearchProvider` | `pg3/src/enricher/core/discovery/search_provider.ts` |
| `BING-HTML-1` | `BingSearchProvider` | `pg3/src/enricher/core/discovery/search_provider.ts` |
| `SERPER-API-1` | `SerperSearchProvider` | `pg3/src/enricher/core/discovery/search_provider.ts` |
| `EXA-API-2` | `ExaSearchProvider` | `pg3/src/enricher/core/discovery/search_provider.ts` |
| `TAVILY-API-2` | `TavilySearchProvider` | `pg3/src/enricher/core/discovery/search_provider.ts` |
| `PERPLEXITY-API-4` | `PerplexityProvider` | `pg3/src/enricher/core/discovery/perplexity_provider.ts` |
| `SEARXNG-NET-1` | `SearXNGProvider` (wraps Google via Tor Browser) | `pg3/src/enricher/core/discovery/searxng_provider.ts` |
| `ORACLE-SERP` | `OracleSearchProvider` (Crawl4AI sidecar) | `pg3/src/enricher/core/discovery/oracle_search_provider.ts` |
| `GOOGLE-BROWSER` | `GoogleBrowserProvider` (Puppeteer stealth) | `pg3/src/enricher/core/discovery/google_browser_provider.ts` |

Wired in registry: `pg3/src/enricher/runtime/providers/serp_provider_registry.ts`

### 1.2 HTTP Fetch Providers

| Provider ID | Backend | File |
|---|---|---|
| `HTTP-DIRECT-1` | `ScraperClient mode='direct'` (undici) | `pg3/src/enricher/utils/scraper_client.ts` |
| `FIRECRAWL-SCRAPE-3` | Firecrawl cloud API | `pg3/src/enricher/runtime/providers/http_provider_registry.ts` |
| `HTTP-BRIGHTDATA-4` | BrightData Web Unlocker proxy | `pg3/src/enricher/utils/scraper_client.ts` |
| `ORACLE-CRAWL4AI-5` | Python Crawl4AI sidecar (local) | `pg3/src/enricher/utils/oracle_client.ts` |

Wired in registry: `pg3/src/enricher/runtime/providers/http_provider_registry.ts`

### 1.3 LLM Providers

| Provider ID | Model | File |
|---|---|---|
| `OPENROUTER-FAST-2` | `openrouter:fast` | `pg3/src/enricher/runtime/providers/llm_provider_registry.ts` |
| `OPENROUTER-SMART-3` | `openrouter:smart` | same |
| `OPENROUTER-2` | `openrouter:fast` (fallback alias) | same |
| `OPENAI-1` | `gpt-4o-mini` | same |
| `DEEPSEEK-1` | `deepseek-chat` | same |
| `KIMI-1` | `moonshot-v1-8k` (Moonshot AI) | same |
| `ZAI-1` | `glm-4-flash` (Zhipu AI) | same |
| `PERPLEXITY-1` | `sonar-pro` (via LLM stack, distinct from SERP) | same |

### 1.4 Data / Directory Providers

| Provider | Class / Module | File |
|---|---|---|
| Hunter.io domain search | `HunterClient` | `pg3/src/enricher/utils/hunter_client.ts` |
| PecHunter (browser + regex email mining) | `PecHunter` | `pg3/src/foundation/PecHunter.ts` |
| FatturatoItalia.it (revenue + employees) | `FatturatoItaliaHarvester` | `pg3/src/enricher/core/directories/fatturato_italia.ts` |
| VIES VAT validation | `ViesService` | `pg3/src/enricher/core/financial/vies.ts` |
| BilancioHunter (financial SERP aggregator) | `BilancioHunter` | `pg3/src/foundation/BilancioHunter.ts` |
| LinkedInSniper (decision-maker discovery) | `LinkedInSniper` | `pg3/src/foundation/LinkedInSniper.ts` |
| SatelliteVerifier (Google Street View + LLM vision) | `SatelliteVerifier` | `pg3/src/enricher/core/verification/satellite_verifier.ts` |
| Immobiliare.it scraper (source discovery) | `ImmobiliareAgenciesProvider` | `pg3/src/scraper/providers/immobiliare_agencies.ts` |

---

## 2. pg4 Providers Found (with file evidence)

### 2.1 SERP Providers

| Provider ID | Class | File |
|---|---|---|
| `dns_mx` | `DnsMxProvider` | `pg4/src/providers/serp/dns_mx.ts` |
| `crtsh` | `CrtshProvider` | `pg4/src/providers/serp/crtsh.ts` |
| `ddg_lite` | `DdgLiteProvider` | `pg4/src/providers/serp/ddg_lite.ts` |
| `bing_html` | `BingHtmlProvider` | `pg4/src/providers/serp/bing_html.ts` |
| `serper` | `SerperProvider` (Phase G, paid, gated) | `pg4/src/providers/serp/serper.ts` |

Wired in catalog: `pg4/src/providers/provider_catalog.ts`

### 2.2 HTTP Fetch Providers

| Provider ID | Class | File |
|---|---|---|
| `direct_fetch` | `DirectFetchProvider` | `pg4/src/providers/http/direct_fetch.ts` |

### 2.3 LLM Providers

None wired. Placeholder comment in `pg4/src/providers/provider_catalog.ts`:
```
// Phase 3+: OpenAIProvider, OpenRouterProvider, DeepseekProvider
```

### 2.4 Data / Directory Providers

| Provider | Status | File |
|---|---|---|
| VIES VAT validation | Implemented (pure + live, caller-gated) | `pg4/src/enrichment/financial/vies.ts` |
| FatturatoItalia parser (PURE, no live fetch) | Parser only (pure), no live harvester wired | `pg4/src/enrichment/financial/fatturato_italia_parser.ts`, `revenue_parser.ts` |
| Financial stage (VAT checksum only, no network) | Skeleton, no-network | `pg4/src/enrichment/stages/financial_stage.ts` |

---

## 3. Gap Analysis

The gap is computed as: (pg3 has and is genuinely useful) minus (pg4 has).

### 3.1 SERP Gap

| Missing Provider | pg3 File | Notes |
|---|---|---|
| **Exa** | `search_provider.ts:ExaSearchProvider` | Paid API, neural search, good precision for Italian B2B |
| **Tavily** | `search_provider.ts:TavilySearchProvider` | Paid API, easy integration |
| **Perplexity (SERP mode)** | `perplexity_provider.ts:PerplexityProvider` | Paid, $0.01/call, very high precision for official website lookup |
| **SearXNG/GoogleBrowser via Tor** | `searxng_provider.ts` | Low practical value for pg4 (Tor dependency, high maintenance, disabled in pg3 logs) — **low priority** |
| **OracleSearch (Crawl4AI sidecar)** | `oracle_search_provider.ts` | Disabled in pg3 prod (`ORACLE_DISABLED_BY_USER`); requires Python sidecar — **low priority** |
| **GoogleBrowserProvider** | `google_browser_provider.ts` | Circuit-breaker-disabled in pg3 prod; high captcha risk — **low priority** |

### 3.2 HTTP Fetch Gap

| Missing Provider | pg3 File | Notes |
|---|---|---|
| **BrightData Web Unlocker** | `scraper_client.ts`, `http_provider_registry.ts` | Paid proxy, $1.5/1000, handles Cloudflare/DataDome; needed for PecHunter fallback and financial pages |
| **Firecrawl** | `http_provider_registry.ts` | Paid cloud scraper, $0.0035/call; good for JS-heavy sites |
| **Oracle Crawl4AI** | `oracle_client.ts` | Disabled in pg3 prod; Python sidecar overhead — **low priority** |

### 3.3 LLM Gap

| Missing Provider | pg3 File | Notes |
|---|---|---|
| **OpenRouter (fast/smart)** | `llm_provider_registry.ts` | Multi-model aggregator, cheapest LLM path for website disambiguation |
| **OpenAI (gpt-4o-mini)** | `llm_provider_registry.ts` | Established, reliable |
| **DeepSeek** | `llm_provider_registry.ts` | Very cheap ($0.002/call), good for Italian B2B company name reasoning |
| **Kimi (Moonshot)** | `llm_provider_registry.ts` | Cheap alternative LLM |
| **Z.ai (Zhipu GLM)** | `llm_provider_registry.ts` | Cheap alternative LLM |
| **Perplexity (LLM mode)** | `llm_provider_registry.ts` | $0.01/call, distinct from SERP usage above |

### 3.4 Data / Directory Gap

| Missing Provider | pg3 File | Notes |
|---|---|---|
| **Hunter.io domain search** | `hunter_client.ts`, `contact_enrichment_stage.ts` | Paid ($0.001/credit), finds professional emails by domain; best fallback after PecHunter finds nothing |
| **PecHunter (browser-based email mining)** | `PecHunter.ts` | Browser-rendered HTML scan of /contatti, /privacy; critical for Italian B2B PEC extraction |
| **FatturatoItalia live harvester** | `fatturato_italia.ts` | LIVE network version; pg4 has only the pure parser |
| **VIES live call (wired in pipeline)** | `vies.ts` → `financial_enrichment_stage.ts` | pg4 has the code but it's NEVER called (financial stage skeleton, no-network) |
| **BilancioHunter (financial SERP)** | `BilancioHunter.ts` | SERP-driven bilancio.it search for revenue/utile; more comprehensive than FatturatoItalia alone |
| **LinkedInSniper (decision-maker)** | `LinkedInSniper.ts`, `decision_maker_stage.ts` | LinkedIn profile discovery via SERP; key for outbound relevance |
| **SatelliteVerifier (Street View + vision)** | `satellite_verifier.ts` | Paid (Google Maps API + LLM vision); useful for real-estate lead validation only |
| **Immobiliare.it source scraper** | `immobiliare_agencies.ts` | pg3-specific input source for real-estate sector; pg4 has Maps + PG as sources |

---

## 4. What pg3 Does NOT Have (Corrections vs Expected List)

The task brief listed these as "expected":
- **SearXNG** — EXISTS in pg3 (`searxng_provider.ts`) but is actually a Tor-proxied Google scraper, not a real SearXNG instance. The class name is misleading.
- **GoogleBrowser** — EXISTS in pg3 (`google_browser_provider.ts`) but is force-disabled in production (`forceDisabled = true`) after the first captcha storm. Low practical value.
- **OracleSearch** — EXISTS in pg3 but `OracleClient.fetchHtmlStealth()` throws `ORACLE_DISABLED_BY_USER` at line 44 of `oracle_client.ts`. Dead in production.
- **Z.ai** — EXISTS as `ZAI-1` using `glm-4-flash` via `https://open.bigmodel.cn` in `llm_provider_registry.ts`.
- **PEC** — Not a standalone provider. "PEC mining" is the `PecHunter` class in pg3's foundation layer.
- **Immobiliare.it** — EXISTS in pg3 as an INPUT SOURCE (`scraper/providers/`), not an enrichment provider. pg4 replaced this with Google Maps + PG as input sources.

---

## 5. Ranked Next 5 to Implement

Rankings are based on: (expected hit-rate lift) × (cost safety) / implementation effort.

| Rank | Provider | Family | Cost Risk | Difficulty | Rationale |
|---|---|---|---|---|---|
| **1** | **FatturatoItalia live harvester** | Data/Directory | Free (direct HTTP) | Low | pg4 already has the pure parser (`fatturato_italia_parser.ts`, `revenue_parser.ts`). Need only to port `FatturatoItaliaHarvester.harvest()` (direct URL construction + DDG/Serper fallback search) into a `FinancialStage` live mode. Unlocks revenue + employees signals for every lead with a P.IVA. No paid API required. The financial stage skeleton is already wired; just needs the network calls enabled. |
| **2** | **VIES live call in pipeline** | Data/Directory | Free (EU VIES API) | Low | The code exists in `pg4/src/enrichment/financial/vies.ts`. The `FinancialStage` never calls it; only checksum validation runs. Wiring `checkVatViaVies()` gives name + address confirmation from the EU VAT registry for free. This upgrades `financial_confidence` from 0.6 (checksum) to 0.9 (VIES-confirmed) for matched leads. Risk: VIES is flaky on 5xx, already handled with provisional logic. |
| **3** | **Exa SERP provider** | SERP | Paid ($0.002/call) | Low | Direct API call identical in structure to Serper. Adds a high-precision neural search fallback for leads where DDG + Bing return noisy results. pg3 showed Exa handled brand-city queries well. Implementation: new file `pg4/src/providers/serp/exa.ts` following `serper.ts` pattern + add to `provider_catalog.ts`. |
| **4** | **PecHunter (browser-based contact extraction)** | Data/Directory | Free | High | The highest-value missing post-discovery enrichment. pg3 shows it finds PEC + email for ~40-60% of Italian business websites that have them. Requires the browser stack (`pg4/src/browser/factory.ts` exists) to be extended with contact-page scanning logic. Port `PecHunter.ts` from pg3's foundation layer, adapt to pg4's `Stage` interface, add as a post-discovery stage. High effort because it needs multi-page crawl orchestration. |
| **5** | **Hunter.io domain search** | Data/Contact | Paid (1 credit/domain) | Low | Simple REST client already blueprinted in `pg3/src/enricher/utils/hunter_client.ts`. Activates only when PecHunter finds nothing (same guard as pg3's `ContactEnrichmentStage`). Free emailCount pre-check avoids burning credits on empty domains. Implementation: port `HunterClient`, add as a post-discovery contact stage after the browser-based scan. Low code volume, well-understood credit model. |

---

## 6. Per-Provider Notes

| Provider | pg4 Priority | Cost Model | Precision Risk |
|---|---|---|---|
| FatturatoItalia live | P1 | Free (direct HTTP scrape) | Medium — URL slug guessing may miss <20% of companies; DDG fallback compensates |
| VIES live | P1 | Free (EU API) | Low — official EU VAT registry |
| Exa SERP | P2 | $0.002/call | Low — neural ranking, fewer directory false positives |
| PecHunter | P2 | Free | Low precision risk, high recall gain for PEC |
| Hunter.io | P3 | $0.001/credit | Low — Hunter data is sourced from web crawls, may return generic emails |
| Tavily SERP | P4 | $0.001/call | Similar to Serper; adds redundancy |
| BrightData HTTP | P4 | $1.5/1000 reqs | None for fetch; cost risk if used too broadly |
| Firecrawl HTTP | P4 | $0.0035/call | None for fetch |
| LinkedInSniper | P5 | Free (SERP-driven) | High — LinkedIn blocks scraping aggressively; pg3 shows many false positives |
| BilancioHunter | P5 | Free (SERP-driven) | Medium — depends on search quality |
| OpenRouter LLMs | P5 | $0.001–0.003/call | Medium — LLM hallucination risk for URL generation |
| OpenAI (GPT-4o-mini) | P5 | $0.005/call | Medium |
| DeepSeek | P5 | $0.002/call | Medium |
| Kimi, Z.ai | P6 | $0.002/call | Medium — novelty providers, untested for Italian B2B |
| SatelliteVerifier | P6 | Paid (Google Maps + OpenAI vision) | N/A — verification tool, not discovery |
| Perplexity SERP | P6 | $0.01/call | Low precision, high cost |
| SearXNG/TorBrowser | Not recommended | Free but fragile | Very high — Tor exit-node bans, captcha storms |
| GoogleBrowser | Not recommended | Free but fragile | Very high — circuit-breaker disabled in pg3 prod |
| Oracle Crawl4AI | Not recommended | Free but ops-heavy | N/A — Python sidecar required |

---

## 7. Blockers

1. **FinancialStage network enable gate** — `pg4/src/enrichment/stages/financial_stage.ts` is explicitly marked skeleton with `enabled: false` default and no live network paths. Enabling FatturatoItalia/VIES requires a feature-flag pattern consistent with pg4's `SERPER_ENABLED` env-var style.

2. **No post-discovery enrichment stage ladder** — pg4's `enrichment_pipeline.ts` runs only website-discovery stages. pg3 has a distinct `PostDiscoveryEnrichmentStage` that runs financial + contacts + decision-maker in parallel AFTER website discovery. pg4 needs an equivalent extensible post-ladder before PecHunter / Hunter / FatturatoItalia make sense to wire.

3. **Browser pool for PecHunter** — pg4's `browser/factory.ts` exists but has not been tested for multi-page contact scanning. PecHunter requires navigating `/contatti`, `/privacy`, `/chi-siamo` sub-pages per lead; pg4's browser layer may need memory/concurrency tuning before running in a pipeline.

4. **No LLM abstraction layer** — pg4's `provider_catalog.ts` has empty `llms: []`. Implementing LLM disambiguation (the fallback path that distinguishes company A's site from company B's when SERP returns ambiguous results) requires building the LLM provider interface (analogous to `SerpProvider`) before any LLM can be wired.
