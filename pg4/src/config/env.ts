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

  // Free SERP routing — R14. The low-yield free providers (dns_mx, crtsh,
  // ddg_lite) are SKIPPED for the `italian_real_estate` category profile.
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
  DEEPSEEK_ENABLED: z.coerce.boolean().default(false),
  DEEPSEEK_API_KEY: z.string().optional(),

  // Enrichment extras
  HUNTER_ENABLED: z.coerce.boolean().default(false),
  HUNTER_API_KEY: z.string().optional(),

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
