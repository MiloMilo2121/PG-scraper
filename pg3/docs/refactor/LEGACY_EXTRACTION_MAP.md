# LEGACY EXTRACTION MAP

Tracking the migration of every legacy module toward the Agent-First architecture rooted at `pg3/src/agent/agent_scraper.ts`.

**Status legend**

- `migrated` — code physically moved into the agent-first path, legacy import removed
- `migrated-deferred` — value identified, kept in place; will be moved in a follow-up PR after the agent path is verified
- `archived` — moved into `pg3/archive/` (no longer on the live path)
- `archive-deferred` — slated for archive, kept temporarily for backwards compatibility
- `deleted` — fully removed
- `keep` — infrastructural module that stays where it is on the live path

The current PR introduces the new agent path additively. No legacy file is moved or deleted yet, so most rows are `*-deferred`.

---

## pg3/src/scraper/

| Module | Useful function | Reintegrated in | Test | Status |
|---|---|---|---|---|
| `scraper/runner.ts` | Cluster Veneto, checkpoint resume, browser refresh every 5 navs, paginazione p-1..p-30 | `agent/backends/campaign_backend.ts` (campaign mode picks single backend; runner becomes optional fallback) | covered indirectly via campaign smoke (TBD) | archive-deferred |
| `scraper/generate_campaign_v2.ts` | Smart LLM-driven category match + province pre-flight + Maps/Immobiliare lanes + dedup | Backend canonico per `mode='campaign'` via `runCampaignProgrammatic` (estratta da `main()`) | unit dispatch test (mocked) | migrated |
| `scraper/scrape_immobiliare_agencies.ts` | Slug mapping IT, challenge detection, optional detail enrichment | Subscraper di `generate_campaign_v2.ts` (`ImmobiliareAgencyProvider`) — ok-as-is | none required | keep |
| `scraper/core/browser/factory_v2.ts` | Browser factory legacy | Sostituita da `factory_v9.ts` con feature flag `BROWSER_ENGINE` | none | archive-deferred |
| `scraper/core/browser/factory_v9.ts` | Browser factory stabilizzata | Stays | existing | keep |
| `scraper/core/browser/evasion.ts` | Anti-fingerprinting v3 (canvas/audio/webgl) | Stays — usata da factory_v9 | existing | keep |
| `scraper/core/browser/ua_db.ts` | User-agent database | Re-export da `shared-runtime/browser/ua_db.ts` | typecheck | migrated |
| `scraper/core/browser/genetic_fingerprinter.ts` | UA/viewport diversity pool | Stays; shared extraction deferred because logger/import semantics differ | existing | keep |
| `scraper/core/browser/cookie_consent.ts` | Auto-clicker banner | Stays | existing | keep |
| `scraper/core/browser/human_behavior.ts` | Mouse/scroll simulation | Stays | existing | keep |
| `scraper/core/browser/proxy_manager.ts` | Tier-based proxy fallback | Stays | existing | keep |
| `scraper/core/browser/request_interceptor_v9.ts` | Request blocking (analytics, ads) | Stays | existing | keep |
| `scraper/ai/category_matcher.ts` | LLM category matching with Z.ai→DeepSeek→GPT fallback | Stays — usata da campaign backend | existing | keep |
| `scraper/ai/municipality_splitter.ts` | LLM splitter per overflow >200 risultati | Stays | existing | keep |
| `scraper/providers/maps_grid_provider.ts` | Google Maps scraping con scroll | Stays | existing | keep |
| `scraper/providers/immobiliare_agencies.ts` | Immobiliare agency scraping | Stays | existing | keep |
| `scraper/utils/deduplicator.ts` | Multi-index dedup (VAT/phone/fingerprint/domain) | Stays | existing | keep |
| `scraper/data/pg_categories.ts` | Master taxonomy + province codes | Stays — referenced by agent_contracts via `PROVINCE_CODES` | existing | keep |

---

## pg3/src/enricher/

| Module | Useful function | Reintegrated in | Test | Status |
|---|---|---|---|---|
| `enricher/scheduler.ts` | `runScheduler(csvPath)`, deterministic MD5 dedup, Redis lock anti-overlap | Backend canonico per `mode='enrichment'` via `enrichment_backend.ts` | `tests/integration/scheduler-smoke.test.ts` (existing) + new `agent-scraper-enrichment-smoke.test.ts` | migrated |
| `enricher/scheduler_csv.ts` | Header alias mapping (50+) e `normalizeCsvRowForScheduler` | Used as-is by scheduler | existing | keep |
| `enricher/worker.ts` | BullMQ consumer, reason_code logic, persistence | Stays — out-of-band (BullMQ worker) | existing | keep |
| `enricher/queue/index.ts` | BullMQ setup, exponential backoff (200ms base) | Stays | existing | keep |
| `enricher/db/index.ts` | SQLite (better-sqlite3), WAL mode, pragmas | Stays | existing | keep |
| `enricher/recover_websites.ts` | DDG fallback con franchise blacklist | Da consolidare in `core/discovery/` come stage opzionale | none | archive-deferred |
| `enricher/split_csv.ts` | Splitter file con/senza website | Post-processing standalone | none | deleted (next PR) |
| `enricher/apply_geriko_tiers.ts` | Tier assignment | Da rivedere | none | archive-deferred |
| `enricher/utils/lead_scorer.ts` | Scoring 0-100 (phone30/website30/VAT20/address10/contact10) | Stays — usata da worker | existing | keep |
| `enricher/utils/deduplicator.ts` | Levenshtein fuzzy match threshold 0.85 + LRU | Stays | existing | keep |
| `enricher/utils/data_merger.ts` | Trust hierarchy REGISTRY→VIES→WEBSITE→PG→MAPS→AI | Stays | existing | keep |
| `enricher/runtime/provider_catalog.ts` | Registry SERP+HTTP+LLM | Stays | existing | keep |
| `enricher/runtime/providers/llm_provider_registry.ts` | OPENAI-1/OPENROUTER-FAST/SMART tiers | Stays | existing | keep |
| `enricher/core/ai/prompt_templates.ts` | Validation/discovery/contact extraction prompts | Stays | existing | keep |
| `enricher/core/discovery/*` | 18 discovery providers (DDG, Google, Perplexity, CRTsh, RDAP) | Stays | existing | keep |
| `enricher/core/financial/*` | Revenue/employee extraction | Stays | existing | keep |

---

## pg3/src/agent_tools/ (legacy CLI surface)

| Tool | Replacement | Status |
|---|---|---|
| `agent_tools/discover_target.ts` | Coperto da `mode='campaign'` o tool discovery futuro; resta per back-compat | archive-deferred |
| `agent_tools/enrich_target.ts` | Coperto da `mode='enrichment'`; resta per back-compat (lavora su singolo target) | archive-deferred |
| `agent_tools/qualify_target.ts` | Mock attuale (returns score=50). Da reimplementare quando `LLMOracleGuard` è cablato | archive-deferred |
| `agent_tools/inspect_run.ts` | Sostituita da `agent/agent_inspect_cli.ts` con registry runId-based | archive-deferred |
| `agent_tools/run_pipeline_module.ts` | Sostituita da `agent_scraper_cli.ts` | archive-deferred |

MCP server — i 5 tool legacy in `mcp_server.ts` sono nascosti salvo `PG3_ENABLE_LEGACY_MCP_TOOLS=true`; i tool in-process ufficiali sono `agent_run` e `agent_inspect_run`.

---

## pg3/src/foundation/

| Module | Reason | Status |
|---|---|---|
| `foundation/BrowserPool.ts` | Re-export di `shared-runtime/browser/BrowserPool.ts` | archive-deferred (rimuovere il facade) |
| `foundation/MemoryFirstCache.ts` | Re-export di `shared-runtime/cache/MemoryFirstCache.ts` | archive-deferred |
| `foundation/provider_catalog.ts` | Wrapper parziale | archive-deferred |
| `foundation/LLMOracleGuard.ts` | Logica business (decisione skip/invoke LLM) — da spostare in `shared-runtime/ai/` | migrated-deferred |
| `foundation/DistributedRateLimiter.ts` | Wrapper Redis sorted set | migrated-deferred (consolidare in `shared-runtime/control/`) |
| `foundation/ShadowRegistry.ts` | SQLite read-only company variants | archive-deferred (domain-specific) |
| `foundation/RunnerV6.ts` | Legacy runner referenziato da `start_runner.sh` | archive-deferred |
| `foundation/InputNormalizer.ts` | Normalizer (usato da agent_tools) | keep (riusato dal campaign backend) |
| `foundation/InputWebsiteCandidate.ts` | URL classification | keep |
| `foundation/BilancioHunter.ts`, `PecHunter.ts`, `LinkedInSniper.ts` | Hunters per enrichment singolo | keep (usati da `enrich_target.ts` legacy + futuri agent tool) |

---

## pg3/src/shared-runtime/ (infrastruttura — keep)

Tutti i moduli sotto `shared-runtime/` restano dove sono e sono il backbone del runtime. Stato: `keep` (nessuna azione richiesta).

- `browser/BrowserPool.ts`, `browser/tls_policy.ts`, `browser/ua_db.ts`
- `cache/MemoryFirstCache.ts`
- `routing/CostRouter.ts`, `routing/provider_catalog.ts`, `routing/provider_adapter.ts`
- `ai/LLMService.ts`
- `security/CaptchaSolver.ts`, `security/block_classifier.ts`
- `budget/CostLedger.ts`
- `config/runtime_config.ts`, `config/runtime_bootstrap.ts`
- `logging/Logger.ts`
- `control/BackpressureValve.ts`
- `network/proxy_tier_v9.ts`

---

## pg3/scripts/ + pg3/src/scripts/

| File | Status | Note |
|---|---|---|
| `src/scripts/v8_benchmark.ts`, `v8_benchmark_wave.ts` | keep | Wave architecture, fixture reali |
| `src/scripts/v6_benchmark_100.ts`, `v7_benchmark_100.ts`, `v7_master_pipeline_test.ts`, `v7_system_audit.ts` | archive-deferred | Versioni precedenti |
| `src/scripts/launch_rescue_mission.ts` | migrated-deferred | NuclearStrategy fallback — futuro tool agent |
| `src/scripts/merge_campaigns.ts`, `scripts/sanitize-master.ts` | migrated-deferred | Schema CSV consolidamento — futuri tool agent |
| `src/scripts/test_*.ts` (oracle, hyperguesser, fatturatoitalia, omega_full_loop, deduction, smart_nuclear, fallback, llm_oracle, oracle_serp, pg_selectors, serper_quick) | archive-deferred | Test integrazione legacy |
| `src/scripts/check_credits.ts`, `verify_flash.ts`, `find_model.ts`, `debug_config.ts`, `diag_browser.ts`, `filter_horeca.ts`, `filter_recovery.ts`, `manual_agent_test_fixed.ts`, `merge_hetzner_data.ts` | archive-deferred / deleted | Diagnostica/legacy |
| `scripts/enrich_campaign_contacts.ts`, `infer_missing_contact_emails.ts`, `evaluate_real_website_discovery.ts`, `filter_missing_websites.ts`, `rescue-run.ts`, `run-phase2-financials.ts`, `sample_e2e_csv.ts`, `test-financial.ts`, `test_apis.ts`, `test_omega_run.ts`, `test_prompt_upgrade.ts` | archive-deferred | One-shot scripts |
| `scripts/run_e2e_*.zsh`, `bootstrap_pg3.sh`, `run_v6.sh`, `start_runner.sh` | archive-deferred | Shell helpers |
| `start_mcp.sh` | keep | Avvio MCP server |
| Root `debug_env.js`, `generate_bz_csv.js`, `generate_pest_control_targets.js`, `test_proxy_axios.js`, `test_5_names.txt` | deleted (next PR) | One-shot artifact |

---

## pg1/ (ex repo precedente)

Modulo intero da migrare in `pg3/src/agent/tools/` in PR successive. Mantenuto per ora come riferimento.

| Modulo pg1 | Pezzo riusabile | Target pg3 | Status |
|---|---|---|---|
| `pg1/src/modules/normalizer/index.ts` | `normalizeCompany()` (regex 13+ suffissi legali IT, stopword), `normalizePhone()` (multi-delimiter, +39/0039), `generateFingerprint()` MD5 | `pg3/src/agent/tools/normalize.ts` | migrated-deferred |
| `pg1/src/modules/scorer/index.ts` | Pesi S1=45, S2=20, S3=15, S4=100; freq reduction phone | `pg3/src/agent/scoring/engine.ts` | migrated-deferred |
| `pg1/src/modules/decider/index.ts` | Reason codes enum (12 varianti), high-risk threshold rules, OpenAI fallback @50-75 | `pg3/src/agent/decide/reasoncodes.ts` | migrated-deferred |
| `pg1/src/modules/deduper/index.ts` | `planUrls()` priorità (source > https > http) | `pg3/src/agent/tools/dedupe.ts` | migrated-deferred |
| `pg1/src/modules/miner/index.ts` | Blacklist Set (paginegialle/facebook/instagram/ebay) con subdomain matching | `pg3/src/agent/mining/blacklist.ts` | migrated-deferred |
| `pg1/src/modules/signal/index.ts` | Token Jaccard per address/name match | `pg3/src/agent/signals/extractor.ts` | migrated-deferred |
| `pg1/src/modules/cache/search-cache.ts` | Disk cache TTL 24h, max 5000 entries, purge expired | `pg3/src/utils/cache.ts` | migrated-deferred |
| `pg1/src/modules/validity/index.ts` | DNS Promise.any A/NS/CNAME + www fallback | `pg3/src/agent/tools/validity.ts` | migrated-deferred |
| `pg1/src/modules/ingestor/index.ts` | CSV delimiter auto-detect (sample 64KB) + Zod | `pg3/src/agent/pipeline/ingest.ts` | migrated-deferred |
| `pg1/src/modules/recovery/recovery-manager.ts` | 4-phase recovery (AI Direct, Deep Search, Sherlock, Franchising) | `pg3/src/agent/recovery/phases.ts` | migrated-deferred |
| `pg1/src/modules/verifier/openai-verifier.ts` | Verification prompt (standard vs Sherlock) + Zod parse | `pg3/src/agent/verify/openai.ts` | migrated-deferred |
| `pg1/src/modules/phone-freq/index.ts` | Tracker freq globale → S1 reduction quando freq>=3 | `pg3/src/agent/scoring/phonefreq.ts` | migrated-deferred |
| `pg1/src/types/index.ts` | DecisionStatus, Candidate, Evidence, ScoreBreakdown, SiteType | `pg3/src/agent/agent_contracts.ts` (extension) | migrated-deferred |
| `pg1/src/config/default.yaml` | ok_score=60, ok_margin=10, high_risk_score=75, high_risk_margin=30, phone_frequency_limit=3 | `pg3/src/agent/config/default.yaml` | migrated-deferred |
| `pg1/tests/normalizer.test.ts`, `scorer.test.ts` | Test fixture preziosi (multi-delimiter, VAT exact match) | `pg3/tests/unit/agent-*.test.ts` | migrated-deferred |
| `pg1/src/modules/browser/*` (hunter/maps_phantom, yellow_ninja) | Genetic fingerprint, human behavior, shadow protocol | Già coperto da pg3 evasion.ts | archive-deferred |

---

## Riepilogo

| Stato | Conteggio |
|---|---:|
| keep | ~30 |
| migrated | 2 (`generate_campaign_v2.ts:runCampaignProgrammatic`, `scheduler.ts:runScheduler`) |
| migrated-deferred | ~14 (modules pg1 + foundation guards) |
| archive-deferred | ~25 (factory_v2, agent_tools, runner.ts, scripts legacy) |
| archived | 0 (questa PR è additiva) |
| deleted | 0 |

**Le PR successive** spostano fisicamente `archive-deferred` in `pg3/archive/` e portano i moduli `migrated-deferred` di pg1 sotto `pg3/src/agent/tools/`. Questa PR introduce il path agent-first senza toccare il codice esistente.
