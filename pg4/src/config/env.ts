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

  // Free SERP providers — R14 pruning. Default OFF: the R12 PD full run
  // (1,492 leads, "agenzie immobiliari") showed these three return ~0 useful
  // results for Italian real-estate SMB website discovery — dns_mx 0/956,
  // crtsh 0/956, ddg_lite 1/956 — while adding 2,868 calls of latency.
  // bing_html (the meaningful free fallback) is always available and is NOT
  // gated. Re-enable per vertical via env if a category benefits from them.
  SERP_DNS_MX_ENABLED: z.coerce.boolean().default(false),
  SERP_CRTSH_ENABLED: z.coerce.boolean().default(false),
  SERP_DDG_LITE_ENABLED: z.coerce.boolean().default(false),

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
