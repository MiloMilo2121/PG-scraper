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

  // HTTP fallbacks
  BRIGHTDATA_ENABLED: z.coerce.boolean().default(false),
  BRIGHTDATA_API_KEY: z.string().optional(),
  FIRECRAWL_ENABLED: z.coerce.boolean().default(false),
  FIRECRAWL_API_KEY: z.string().optional(),
  ORACLE_CRAWL4AI_URL: z.string().url().optional(),

  // LLM providers
  OPENAI_ENABLED: z.coerce.boolean().default(false),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default(DEFAULTS.llm.defaultModel),
  OPENROUTER_ENABLED: z.coerce.boolean().default(false),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default(DEFAULTS.llm.openrouterModel),
  DEEPSEEK_ENABLED: z.coerce.boolean().default(false),
  DEEPSEEK_API_KEY: z.string().optional(),
  // Anthropic — default judge LLM for the judgment layer (L4/L5). PAID,
  // disabled by default like every other paid provider (paid-gate OFF).
  ANTHROPIC_ENABLED: z.coerce.boolean().default(false),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default(DEFAULTS.llm.anthropicModel),

  // Enrichment extras
  HUNTER_ENABLED: z.coerce.boolean().default(false),
  HUNTER_API_KEY: z.string().optional(),

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
export function assertPaidSecrets(): void {
  const env = getEnv();
  const paidCandidates: Array<{ name: string; enabled: boolean; key?: string; keyVar: string; enableVar: string }> = [
    { name: 'serper', enabled: env.SERPER_ENABLED, key: env.SERPER_API_KEY, keyVar: 'SERPER_API_KEY', enableVar: 'SERPER_ENABLED' },
    { name: 'exa', enabled: env.EXA_ENABLED, key: env.EXA_API_KEY, keyVar: 'EXA_API_KEY', enableVar: 'EXA_ENABLED' },
    { name: 'tavily', enabled: env.TAVILY_ENABLED, key: env.TAVILY_API_KEY, keyVar: 'TAVILY_API_KEY', enableVar: 'TAVILY_ENABLED' },
    { name: 'brightdata', enabled: env.BRIGHTDATA_ENABLED, key: env.BRIGHTDATA_API_KEY, keyVar: 'BRIGHTDATA_API_KEY', enableVar: 'BRIGHTDATA_ENABLED' },
  ];
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
