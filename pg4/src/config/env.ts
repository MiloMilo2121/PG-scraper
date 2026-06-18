import 'dotenv/config';
import { z } from 'zod';
import { DEFAULTS } from './defaults';

/**
 * Environment schema. All keys optional except NODE_ENV.
 * Missing API keys do NOT fail validation — they cause the corresponding
 * provider to be silently dropped from the registry at runtime.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  LOG_FORMAT: z.enum(['pretty', 'json']).optional(),

  // Pipeline tuning
  CONCURRENCY: z.coerce.number().int().positive().optional(),
  COST_CEILING_EUR_PER_LEAD: z.coerce.number().nonnegative().optional(),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().optional(),

  // Free SERP routing — R14. The low-yield free provider `ddg_lite` is
  // SKIPPED for the `italian_real_estate` category profile (dns_mx + crtsh
  // were deleted outright in Gate-0).
  // R12 evidence (1,492 leads): the free SERP tier produced 0 final-website
  // conversions; all 536 websites came from input/guess methods + direct_fetch.
  // Set true to force the full free SERP set even for that profile (debug or
  // other-vertical evaluation). See src/providers/provider_policy.ts.
  SERP_EXPANDED_FREE_ENABLED: z.coerce.boolean().default(false),

  // SERP providers
  SERPER_ENABLED: z.coerce.boolean().default(false),
  SERPER_API_KEY: z.string().optional(),
  EXA_ENABLED: z.coerce.boolean().default(false),
  EXA_API_KEY: z.string().optional(),
  TAVILY_ENABLED: z.coerce.boolean().default(false),
  TAVILY_API_KEY: z.string().optional(),
  PERPLEXITY_ENABLED: z.coerce.boolean().default(false),
  PERPLEXITY_API_KEY: z.string().optional(),
  PERPLEXITY_BASE_URL: z.string().url().default('https://api.perplexity.ai'),
  PERPLEXITY_MODEL: z.string().default('sonar'),

  // HTTP fallbacks (WEB_FETCH / WEB_UNBLOCK roles)
  BRIGHTDATA_ENABLED: z.coerce.boolean().default(false),
  BRIGHTDATA_API_KEY: z.string().optional(), // legacy single-key (kept for back-compat)
  BRIGHTDATA_API_TOKEN: z.string().optional(), // current token auth (pg3-recovered)
  BRIGHTDATA_WEB_UNLOCKER_ZONE: z.string().optional(), // zone for WEB_UNBLOCK
  BRIGHTDATA_SERP_ZONE: z.string().optional(), // zone for SEARCH_WEB (serp) — distinct id brightdata_serp
  FIRECRAWL_ENABLED: z.coerce.boolean().default(false),
  FIRECRAWL_API_KEY: z.string().optional(),
  FIRECRAWL_BASE_URL: z.string().url().default('https://api.firecrawl.dev'),
  ORACLE_CRAWL4AI_URL: z.string().url().optional(),

  // LLM providers
  OPENAI_ENABLED: z.coerce.boolean().default(false),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default(DEFAULTS.llm.defaultModel),
  OPENROUTER_ENABLED: z.coerce.boolean().default(false),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default(DEFAULTS.llm.openrouterModel),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  DEEPSEEK_ENABLED: z.coerce.boolean().default(false),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
  DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com'),
  // Zhipu GLM (Z.AI) — LLM_CHEAP. OpenAI-compatible. PAID (no assumed free tier — see addendum R6).
  ZHIPU_ENABLED: z.coerce.boolean().default(false),
  ZHIPU_API_KEY: z.string().optional(),
  ZHIPU_MODEL: z.string().default('glm-4-flash'),
  ZHIPU_BASE_URL: z.string().url().default('https://api.z.ai/api/paas/v4'),
  // Kimi (Moonshot) — LLM_CHEAP / long-context. OpenAI-compatible. Key recovered as KIMI_API_KEY.
  KIMI_ENABLED: z.coerce.boolean().default(false),
  KIMI_API_KEY: z.string().optional(),
  KIMI_MODEL: z.string().default('moonshot-v1-8k'),
  KIMI_BASE_URL: z.string().url().default('https://api.moonshot.ai/v1'),
  // Anthropic — default judge LLM for the judgment layer (L4/L5). PAID,
  // disabled by default like every other paid provider (paid-gate OFF).
  ANTHROPIC_ENABLED: z.coerce.boolean().default(false),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default(DEFAULTS.llm.anthropicModel),

  // Enrichment extras — email find/verify + B2B contact
  HUNTER_ENABLED: z.coerce.boolean().default(false),
  HUNTER_API_KEY: z.string().optional(),
  // Snov.io — EMAIL_FIND/VERIFY/B2B (deferred: Hunter covers these; see addendum R6). OAuth2 creds.
  SNOV_ENABLED: z.coerce.boolean().default(false),
  SNOV_CLIENT_ID: z.string().optional(),
  SNOV_CLIENT_SECRET: z.string().optional(),
  // 2Captcha — CAPTCHA_SOLVE, gated; NEVER for official/government sources. Key recovered as 2CAPTCHA_API_KEY.
  TWOCAPTCHA_ENABLED: z.coerce.boolean().default(false),
  TWOCAPTCHA_API_KEY: z.string().optional(),
  // Residential proxy (RESIDENTIAL_IP) — explicit operator flag + compliance sign-off only.
  PROXY_RESIDENTIAL_URL: z.string().optional(),

  // Official Italian company-data sources (OFFICIAL_COMPANY_DATA role). Free sources default ON.
  OFFICIAL_DATA_VIES_ENABLED: z.coerce.boolean().default(true),
  OFFICIAL_DATA_FATTURATOITALIA_ENABLED: z.coerce.boolean().default(true),
  // A-axis open-data harvest adapters (TENDER_CONTRACTS / CERTIFICATIONS) — P1, not yet wired.
  ANAC_TED_ENABLED: z.coerce.boolean().default(false),
  ACCREDIA_ENABLED: z.coerce.boolean().default(false),

  // Judgment-layer sources (all disabled by default; presence-before-depth).
  // Google Places API — official source for Maps/GBP/reviews/hours (plan §19).
  GOOGLE_PLACES_ENABLED: z.coerce.boolean().default(false),
  GOOGLE_PLACES_API_KEY: z.string().optional(),
  // Ad transparency libraries (Meta Ad Library / Google Ads Transparency).
  ADLIB_ENABLED: z.coerce.boolean().default(false),
  ADLIB_API_KEY: z.string().optional(),

  // Openapi.com — official Italian company registry (InfoCamere reseller). PAID,
  // disabled by default. Used ONLY for top companies on explicit request (the
  // activation layer — see docs/openapi_layer_rules.md). The free IT-search tier
  // (≤100/day) still requires the key + enabled. Base URL switches prod/sandbox.
  OPENAPI_ENABLED: z.coerce.boolean().default(false),
  OPENAPI_API_KEY: z.string().optional(),
  OPENAPI_BASE_URL: z.string().url().default('https://company.openapi.com'),

  // Browser
  PLAYWRIGHT_HEADLESS: z.coerce.boolean().default(true),
  PATCHRIGHT_ENABLED: z.coerce.boolean().default(false),

  // Tests
  RUN_SMOKE: z.coerce.boolean().default(false),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (!cached) {
    cached = EnvSchema.parse(process.env);
  }
  return cached;
}

/**
 * Test-only seam: clears the memoized env so a test can mutate
 * `process.env` and observe the new value on the next `getEnv()`.
 * Never call this in production code paths.
 */
export function resetEnvCache(): void {
  cached = null;
}

/**
 * Phase B.4 — fail fast with an actionable message when the operator asked
 * for paid providers but none is actually usable. Without this, a missing
 * SERPER_API_KEY silently dropped the provider from the registry and the
 * "paid" run completed free-only with no signal.
 */
/**
 * Addendum R3 — the paid-provider candidate table. Data-driven so enabling ANY
 * paid provider (not just the original four) satisfies `--enable-paid`. Each entry
 * names the enable flag + the secret that makes it usable. Snov uses its OAuth
 * client secret as the "key". Keep in sync with the role registry / catalog.
 */
export function paidProviderCandidates(): Array<{ name: string; enabled: boolean; key?: string; keyVar: string; enableVar: string }> {
  const env = getEnv();
  return [
    { name: 'serper', enabled: env.SERPER_ENABLED, key: env.SERPER_API_KEY, keyVar: 'SERPER_API_KEY', enableVar: 'SERPER_ENABLED' },
    { name: 'exa', enabled: env.EXA_ENABLED, key: env.EXA_API_KEY, keyVar: 'EXA_API_KEY', enableVar: 'EXA_ENABLED' },
    { name: 'tavily', enabled: env.TAVILY_ENABLED, key: env.TAVILY_API_KEY, keyVar: 'TAVILY_API_KEY', enableVar: 'TAVILY_ENABLED' },
    { name: 'perplexity', enabled: env.PERPLEXITY_ENABLED, key: env.PERPLEXITY_API_KEY, keyVar: 'PERPLEXITY_API_KEY', enableVar: 'PERPLEXITY_ENABLED' },
    { name: 'brightdata', enabled: env.BRIGHTDATA_ENABLED, key: env.BRIGHTDATA_API_TOKEN ?? env.BRIGHTDATA_API_KEY, keyVar: 'BRIGHTDATA_API_TOKEN', enableVar: 'BRIGHTDATA_ENABLED' },
    { name: 'firecrawl', enabled: env.FIRECRAWL_ENABLED, key: env.FIRECRAWL_API_KEY, keyVar: 'FIRECRAWL_API_KEY', enableVar: 'FIRECRAWL_ENABLED' },
    { name: 'openai', enabled: env.OPENAI_ENABLED, key: env.OPENAI_API_KEY, keyVar: 'OPENAI_API_KEY', enableVar: 'OPENAI_ENABLED' },
    { name: 'openrouter', enabled: env.OPENROUTER_ENABLED, key: env.OPENROUTER_API_KEY, keyVar: 'OPENROUTER_API_KEY', enableVar: 'OPENROUTER_ENABLED' },
    { name: 'deepseek', enabled: env.DEEPSEEK_ENABLED, key: env.DEEPSEEK_API_KEY, keyVar: 'DEEPSEEK_API_KEY', enableVar: 'DEEPSEEK_ENABLED' },
    { name: 'zhipu', enabled: env.ZHIPU_ENABLED, key: env.ZHIPU_API_KEY, keyVar: 'ZHIPU_API_KEY', enableVar: 'ZHIPU_ENABLED' },
    { name: 'kimi', enabled: env.KIMI_ENABLED, key: env.KIMI_API_KEY, keyVar: 'KIMI_API_KEY', enableVar: 'KIMI_ENABLED' },
    { name: 'anthropic', enabled: env.ANTHROPIC_ENABLED, key: env.ANTHROPIC_API_KEY, keyVar: 'ANTHROPIC_API_KEY', enableVar: 'ANTHROPIC_ENABLED' },
    { name: 'hunter', enabled: env.HUNTER_ENABLED, key: env.HUNTER_API_KEY, keyVar: 'HUNTER_API_KEY', enableVar: 'HUNTER_ENABLED' },
    { name: 'snov', enabled: env.SNOV_ENABLED, key: env.SNOV_CLIENT_SECRET, keyVar: 'SNOV_CLIENT_SECRET', enableVar: 'SNOV_ENABLED' },
    { name: 'google_places', enabled: env.GOOGLE_PLACES_ENABLED, key: env.GOOGLE_PLACES_API_KEY, keyVar: 'GOOGLE_PLACES_API_KEY', enableVar: 'GOOGLE_PLACES_ENABLED' },
    { name: 'openapi', enabled: env.OPENAPI_ENABLED, key: env.OPENAPI_API_KEY, keyVar: 'OPENAPI_API_KEY', enableVar: 'OPENAPI_ENABLED' },
    { name: '2captcha', enabled: env.TWOCAPTCHA_ENABLED, key: env.TWOCAPTCHA_API_KEY, keyVar: 'TWOCAPTCHA_API_KEY', enableVar: 'TWOCAPTCHA_ENABLED' },
  ];
}

export function assertPaidSecrets(): void {
  const paidCandidates = paidProviderCandidates();
  const usable = paidCandidates.filter((p) => p.enabled && p.key && p.key.length > 0);
  if (usable.length > 0) return;

  const enabledButKeyless = paidCandidates.filter((p) => p.enabled && (!p.key || p.key.length === 0));
  if (enabledButKeyless.length > 0) {
    const names = enabledButKeyless.map((p) => `${p.name} (${p.enableVar}=true but ${p.keyVar} is empty)`).join(', ');
    throw new Error(
      `--enable-paid was passed but no paid provider has a usable API key: ${names}. ` +
        `Set the missing key in .env, or drop --enable-paid to run free-only.`
    );
  }
  throw new Error(
    `--enable-paid was passed but no paid provider is enabled in the environment. ` +
      `Set e.g. SERPER_ENABLED=true and SERPER_API_KEY=<key> in .env, or drop --enable-paid to run free-only.`
  );
}

/** Resolved runtime config — env merged onto DEFAULTS. */
export function getConfig() {
  const env = getEnv();
  return {
    env,
    pipeline: {
      concurrency: env.CONCURRENCY ?? DEFAULTS.pipeline.concurrency,
      costCeilingEurPerLead: env.COST_CEILING_EUR_PER_LEAD ?? DEFAULTS.pipeline.costCeilingEurPerLead,
      requestTimeoutMs: env.REQUEST_TIMEOUT_MS ?? DEFAULTS.pipeline.requestTimeoutMs,
      perStageTimeoutMs: DEFAULTS.pipeline.perStageTimeoutMs,
    },
    scraper: DEFAULTS.scraper,
    cache: DEFAULTS.cache,
    http: DEFAULTS.http,
    llm: DEFAULTS.llm,
    scoring: DEFAULTS.scoring,
  } as const;
}

export type ResolvedConfig = ReturnType<typeof getConfig>;
