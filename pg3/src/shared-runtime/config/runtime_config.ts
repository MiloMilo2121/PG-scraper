import * as path from 'path';
import { z } from 'zod';

/**
 * 🛠️ STRICT CONFIGURATION SCHEMA (Law 106)
 * Validates environment variables at startup.
 * Uses z.coerce to automatically handle string-to-number conversions.
 */

const BooleanString = z.string().transform((val) => val?.toLowerCase() === 'true');
const CommaSeparatedString = z.string().transform((val) => val.split(',').map((s) => s.trim()).filter(Boolean));

const EnvSchema = z.object({
  // 🟢 CORE
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SERVICE_NAME: z.string().default('antigravity-enricher'),
  SQLITE_PATH: z.string().default('./data/antigravity.db'),
  HEALTH_PORT: z.coerce.number().min(1).max(65535).default(3000),
  RUNTIME_DATA_DIR: z.string().default('./data'),
  COST_LEDGER_PATH: z.string().optional(),
  BROWSER_SESSION_DIR: z.string().optional(),
  BROWSER_POOL_MAX_INSTANCES: z.coerce.number().min(1).max(32).default(3),
  BROWSER_POOL_MAX_REQUESTS_PER_INSTANCE: z.coerce.number().min(1).max(500).default(50),
  BROWSER_POOL_NAV_TIMEOUT_MS: z.coerce.number().min(1000).max(120000).default(8000),
  BACKPRESSURE_INITIAL_CONCURRENCY: z.coerce.number().min(1).max(100).default(3),
  BACKPRESSURE_MAX_CONCURRENCY: z.coerce.number().min(1).max(200).default(15),

  // 🤖 AI / LLM
  OPENAI_API_KEY: CommaSeparatedString.optional(),
  OPENROUTER_API_KEY: CommaSeparatedString.optional(),
  OPENROUTER_MODEL_FAST: z.string().optional(),
  OPENROUTER_MODEL_SMART: z.string().optional(),
  Z_AI_API_KEY: CommaSeparatedString.optional(),
  DEEPSEEK_API_KEY: CommaSeparatedString.optional(),
  KIMI_API_KEY: CommaSeparatedString.optional(),
  EXA_API_KEY: CommaSeparatedString.optional(),
  FIRECRAWL_API_KEY: CommaSeparatedString.optional(),
  SERPER_API_KEY: CommaSeparatedString.optional(),
  TAVILY_API_KEY: CommaSeparatedString.optional(),
  LLM_MODEL: z.string().optional(),
  LLM_MODEL_FAST: z.string().optional(),
  LLM_MODEL_SMART: z.string().optional(),
  AI_MODEL_FAST: z.string().optional(),
  AI_MODEL_SMART: z.string().optional(),
  AI_MAX_TOKENS: z.coerce.number().min(100).max(10000).default(500),

  // 🔴 REDIS
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // 🕸️ SCRAPING & BROWSER
  HEADLESS: BooleanString.default(true),
  MAX_CONCURRENCY: z.coerce.number().min(1).max(50).default(5),
  CHROME_PATH: z.string().optional(),
  BROWSER_MODE: z.enum(['local', 'remote']).default('local'),
  REMOTE_BROWSER_ENDPOINT: z.string().optional(),
  GENETIC_EVOLUTION_INTERVAL: z.coerce.number().min(1).default(50),

  // ⏱️ TIMEOUTS
  SCRAPING_TIMEOUT: z.coerce.number().min(1000).default(30000),
  MAX_RETRIES: z.coerce.number().min(1).default(3),
  PAGE_LOAD_TIMEOUT: z.coerce.number().min(1000).default(60000),


  BRIGHTDATA_WEB_UNLOCKER_URL: z.string().optional(),
  PROXY_RESIDENTIAL_URL: z.string().optional(),
  PROXY_DATACENTER_URL: z.string().optional(),
  PROXY_MOBILE_URL: z.string().optional(),
  PROXY_FAILURE_COOLDOWN_MS: z.coerce.number().min(1000).default(300000), // 5 min

  // 📍 DISCOVERY THRESHOLDS
  DISCOVERY_THRESHOLD_WAVE1: z.coerce.number().min(0).max(1).default(0.70), // Swarm: lower = more candidates pass
  DISCOVERY_THRESHOLD_WAVE2: z.coerce.number().min(0).max(1).default(0.65), // Net: Bing/DDG (lower reliability)
  DISCOVERY_THRESHOLD_WAVE3: z.coerce.number().min(0).max(1).default(0.80), // Judge: AI final validation (higher)
  DISCOVERY_THRESHOLD_MIN_VALID: z.coerce.number().min(0).max(1).default(0.55), // Absolute minimum to accept
  DISCOVERY_VERIFICATION_CACHE_MAX_ENTRIES: z.coerce.number().min(100).default(2000),
  DISCOVERY_DEFAULT_MODE: z.enum(['FAST_RUN1', 'DEEP_RUN2', 'AGGRESSIVE_RUN3', 'NUCLEAR_RUN4']).default('DEEP_RUN2'),
  DISCOVERY_ENABLE_BROWSER: BooleanString.default(true),
  DISCOVERY_STOP_THE_BLEEDING: BooleanString.default(false),

  // ⚡ PERFORMANCE & QUEUE
  CONCURRENCY_LIMIT: z.coerce.number().min(1).max(100).default(10),
  RETRY_ATTEMPTS: z.coerce.number().min(1).max(10).default(3),
  RETRY_DELAY_MS: z.coerce.number().min(100).default(1000),
  QUEUE_BATCH_SIZE: z.coerce.number().min(1).max(1000).default(100),
  QUEUE_LOCK_DURATION_MS: z.coerce.number().min(30000).default(900000),
  QUEUE_STALLED_INTERVAL_MS: z.coerce.number().min(30000).default(120000),
  QUEUE_MAX_STALLED_COUNT: z.coerce.number().min(0).max(10).default(2),
  REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().min(500).default(5000),
  REDIS_CONNECT_RETRIES: z.coerce.number().min(0).default(5),
  SCHEDULER_LOCK_TTL_MS: z.coerce.number().min(30000).default(900000), // 15 min
  QUEUE_PREFIX: z.string().min(1).default('bull'),

  // 🏃 RUNNER
  RUNNER_CONCURRENCY_LIMIT: z.coerce.number().min(1).max(200).default(25),
  RUNNER_MEMORY_WARN_MB: z.coerce.number().min(256).default(20000),
  RUNNER_PROGRESS_LOG_EVERY: z.coerce.number().min(1).default(20),

  // 🧠 KNOWLEDGE GRAPH & INTERNAL
  NEO4J_URI: z.string().default('bolt://localhost:7687'),
  NEO4J_USER: z.string().default('neo4j'),
  NEO4J_PASSWORD: z.string().default('password'),
  GOOGLE_STREET_VIEW_KEY: z.string().optional(),

  // 📧 HUNTER.IO (Email Discovery)
  HUNTER_API_KEY: z.string().optional(),
  HUNTER_ENABLED: BooleanString.default(false),

  // 📱 NOTIFICATIONS
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  // 🧩 MISC
  AI_CACHE_MAX_ENTRIES: z.coerce.number().min(10).default(500),
  AI_CACHE_TTL_MS: z.coerce.number().min(1000).default(3600000), // 1 hour
  DEDUPLICATOR_MAX_COMPANIES: z.coerce.number().min(1000).default(100000),
  CAPTCHA_MAX_ATTEMPTS: z.coerce.number().min(1).default(30),
  TWO_CAPTCHA_API_KEY: z.string().optional(),

  // JINA (REMOVED — using internal DomDistiller fallback)

  // 🚩 OMEGA 6.2 FEATURE FLAGS & GUARDRAILS
  DISCOVERY_GOOGLE_BROWSER_ENABLED: BooleanString.default(true),
  DISCOVERY_AI_VARIANTS_ENABLED: BooleanString.default(true),
  DISCOVERY_PERPLEXITY_ENABLED: BooleanString.default(false), // Heavy fallback disabled by default

  // 🛡️ GOOGLE BROWSER ENGINE GUARDRAILS
  GOOGLE_BROWSER_MAX_QUERIES_PER_SEC: z.coerce.number().min(0.1).max(1).default(0.15), // roughly 1 query every 6.6s
  GOOGLE_BROWSER_MAX_QUERIES_PER_COMPANY: z.coerce.number().min(1).max(5).default(2),
  GOOGLE_BROWSER_CAPTCHA_AUTO_DISABLE_THRESHOLD: z.coerce.number().min(0.01).max(1).default(0.10), // Auto disable if > 10% hit rate

  // 💰 BUDGET LIMITS
  MAX_COST_PER_COMPANY_EUR: z.coerce.number().min(0.0001).max(0.1).default(0.01),
  LOCAL_BROWSER_NAV_COST_EUR: z.coerce.number().min(0).max(0.1).default(0),
  LOCAL_ORACLE_FETCH_COST_EUR: z.coerce.number().min(0).max(0.1).default(0),
});

function resolveFsPath(targetPath: string): string {
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(targetPath);
}

function deriveLlmDefaults(env: Env) {
  if (env.Z_AI_API_KEY?.length) {
    return {
      fast: 'glm-4.7-flash',
      smart: 'glm-5',
    };
  }

  if (env.DEEPSEEK_API_KEY?.length) {
    return {
      fast: 'deepseek-chat',
      smart: 'deepseek-reasoner',
    };
  }

  if (env.KIMI_API_KEY?.length) {
    return {
      fast: 'kimi-k2.5',
      smart: 'kimi-k2-thinking',
    };
  }

  return {
    fast: 'gpt-5-mini',
    smart: 'gpt-4o',
  };
}

/**
 * Helper to derive Redis connection details
 */
function deriveRedis(env: Env) {
  if (env.REDIS_URL) {
    const url = new URL(env.REDIS_URL);
    return {
      url: env.REDIS_URL,
      host: url.hostname,
      port: Number(url.port) || 6379,
      password: url.password || env.REDIS_PASSWORD,
    };
  }
  return {
    url: `redis://${env.REDIS_PASSWORD ? `:${env.REDIS_PASSWORD}@` : ''}${env.REDIS_HOST}:${env.REDIS_PORT}`,
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
  };
}

type Env = z.infer<typeof EnvSchema>;

function parseEnv(rawEnv: NodeJS.ProcessEnv): Env {
  const parsed = EnvSchema.safeParse(rawEnv);

  if (!parsed.success) {
    console.error("❌ INVALID CONFIGURATION:");
    parsed.error.issues.forEach((issue) => {
      console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
    });
    process.exit(1);
  }

  return parsed.data;
}

function buildConfig(env: Env) {
  const llmDefaults = deriveLlmDefaults(env);
  const resolvedFastModel = env.AI_MODEL_FAST || env.LLM_MODEL_FAST || llmDefaults.fast;
  const resolvedSmartModel = env.AI_MODEL_SMART || env.LLM_MODEL_SMART || env.LLM_MODEL || llmDefaults.smart;
  const resolvedDefaultModel = env.LLM_MODEL || resolvedSmartModel;
  const runtimeDataDir = resolveFsPath(env.RUNTIME_DATA_DIR);
  const costLedgerPath = resolveFsPath(env.COST_LEDGER_PATH || path.join(runtimeDataDir, 'cost_ledger.jsonl'));
  const browserSessionDir = resolveFsPath(env.BROWSER_SESSION_DIR || path.join(runtimeDataDir, 'browser-sessions'));

  return {
    ...env,
    browser: {
      headless: env.HEADLESS,
      maxConcurrency: env.MAX_CONCURRENCY,
      chromePath: env.CHROME_PATH,
      mode: env.BROWSER_MODE,
      remoteEndpoint: env.REMOTE_BROWSER_ENDPOINT,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      geneticEvolutionInterval: env.GENETIC_EVOLUTION_INTERVAL,
    },
    scraping: {
      timeout: env.SCRAPING_TIMEOUT,
      maxRetries: env.MAX_RETRIES,
      pageLoadTimeout: env.PAGE_LOAD_TIMEOUT,
    },
    redis: deriveRedis(env),
    llm: {
      apiKey: env.OPENAI_API_KEY?.[0],
      apiKeys: env.OPENAI_API_KEY || [],
      openrouter: {
        apiKey: env.OPENROUTER_API_KEY?.[0],
        apiKeys: env.OPENROUTER_API_KEY || [],
        baseUrl: 'https://openrouter.ai/api/v1',
        fastModel: env.OPENROUTER_MODEL_FAST || 'openai/gpt-5-nano',
        smartModel: env.OPENROUTER_MODEL_SMART || 'google/gemini-2.5-flash-lite',
      },
      z_ai: {
        apiKey: env.Z_AI_API_KEY?.[0],
        apiKeys: env.Z_AI_API_KEY || [],
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      },
      deepseek: {
        apiKey: env.DEEPSEEK_API_KEY?.[0],
        apiKeys: env.DEEPSEEK_API_KEY || [],
        baseUrl: 'https://api.deepseek.com',
      },
      kimi: {
        apiKey: env.KIMI_API_KEY?.[0],
        apiKeys: env.KIMI_API_KEY || [],
        baseUrl: 'https://api.moonshot.cn/v1',
      },
      model: resolvedDefaultModel,
      fastModel: resolvedFastModel,
      smartModel: resolvedSmartModel,
      maxTokens: env.AI_MAX_TOKENS,
      temperature: 0.1,
      pricing: {
        'glm-5': { inputPer1M: 1.00, outputPer1M: 3.20 },
        'glm-4.7': { inputPer1M: 0.60, outputPer1M: 2.20 },
        'glm-4.7-flashx': { inputPer1M: 0.07, outputPer1M: 0.40 },
        'glm-4.7-flash': { inputPer1M: 0, outputPer1M: 0 },
        'glm-4.5-flash': { inputPer1M: 0, outputPer1M: 0 },
        'glm-4.5': { inputPer1M: 0.60, outputPer1M: 2.20 },
        'gpt-5-mini': { inputPer1M: 0.10, outputPer1M: 0.40 },
        'openai/gpt-5-nano': { inputPer1M: 0.05, outputPer1M: 0.40 },
        'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.60 },
        'gpt-4o': { inputPer1M: 2.50, outputPer1M: 10.00 },
        'google/gemini-2.5-flash-lite': { inputPer1M: 0.10, outputPer1M: 0.40 },
        'o3-mini': { inputPer1M: 1.10, outputPer1M: 4.40 },
        'deepseek-chat': { inputPer1M: 0.14, outputPer1M: 0.28 },
        'deepseek-v3.2': { inputPer1M: 0.28, outputPer1M: 0.42 },
        'deepseek-reasoner': { inputPer1M: 0.55, outputPer1M: 2.19 },
        'kimi-k2.5': { inputPer1M: 0.60, outputPer1M: 3.00 },
        'kimi-k2-thinking': { inputPer1M: 0.60, outputPer1M: 2.50 },
        'moonshot-v1-8k': { inputPer1M: 0.20, outputPer1M: 2.00 },
      } as Record<string, { inputPer1M: number; outputPer1M: number }>,
    },
    search: {
      exa: {
        apiKey: env.EXA_API_KEY?.[0],
        apiKeys: env.EXA_API_KEY || [],
        baseUrl: 'https://api.exa.ai',
      },
      firecrawl: {
        apiKey: env.FIRECRAWL_API_KEY?.[0],
        apiKeys: env.FIRECRAWL_API_KEY || [],
        baseUrl: 'https://api.firecrawl.dev/v2',
      },
    },
    google: {
      streetViewKey: env.GOOGLE_STREET_VIEW_KEY,
    },
    neo4j: {
      uri: env.NEO4J_URI,
      user: env.NEO4J_USER,
      password: env.NEO4J_PASSWORD,
    },
    queue: {
      concurrencyLimit: env.CONCURRENCY_LIMIT,
      retryAttempts: env.RETRY_ATTEMPTS,
      retryDelayMs: env.RETRY_DELAY_MS,
      batchSize: env.QUEUE_BATCH_SIZE,
      lockDurationMs: env.QUEUE_LOCK_DURATION_MS,
      stalledIntervalMs: env.QUEUE_STALLED_INTERVAL_MS,
      maxStalledCount: env.QUEUE_MAX_STALLED_COUNT,
      redisConnectTimeoutMs: env.REDIS_CONNECT_TIMEOUT_MS,
      redisConnectRetries: env.REDIS_CONNECT_RETRIES,
      schedulerLockTtlMs: env.SCHEDULER_LOCK_TTL_MS,
      prefix: env.QUEUE_PREFIX,
    },
    runner: {
      concurrencyLimit: env.RUNNER_CONCURRENCY_LIMIT,
      memoryWarnMb: env.RUNNER_MEMORY_WARN_MB,
      progressLogEvery: env.RUNNER_PROGRESS_LOG_EVERY,
    },
    discovery: {
      thresholds: {
        wave1: env.DISCOVERY_THRESHOLD_WAVE1,
        wave2: env.DISCOVERY_THRESHOLD_WAVE2,
        wave3: env.DISCOVERY_THRESHOLD_WAVE3,
        minValid: env.DISCOVERY_THRESHOLD_MIN_VALID,
      },
      verificationCacheMaxEntries: env.DISCOVERY_VERIFICATION_CACHE_MAX_ENTRIES,
      defaultMode: env.DISCOVERY_DEFAULT_MODE,
      enableBrowser: env.DISCOVERY_ENABLE_BROWSER,
      stopTheBleeding: env.DISCOVERY_STOP_THE_BLEEDING,
      perplexityEnabled: env.DISCOVERY_PERPLEXITY_ENABLED,
    },
    ai: {
      cacheMaxEntries: env.AI_CACHE_MAX_ENTRIES,
      cacheTtlMs: env.AI_CACHE_TTL_MS,
    },
    deduplication: {
      maxKnownCompanies: env.DEDUPLICATOR_MAX_COMPANIES,
    },
    proxy: {
      residentialUrl: env.PROXY_RESIDENTIAL_URL || '',
      datacenterUrl: env.PROXY_DATACENTER_URL || '',
      mobileUrl: env.PROXY_MOBILE_URL || '',
      failureCooldownMs: env.PROXY_FAILURE_COOLDOWN_MS,
    },
    brightData: {
      webUnlockerUrl: env.BRIGHTDATA_WEB_UNLOCKER_URL,
    },
    captcha: {
      maxAttempts: env.CAPTCHA_MAX_ATTEMPTS,
    },
    health: {
      port: env.HEALTH_PORT,
    },
    sqlitePath: env.SQLITE_PATH,
    serviceName: env.SERVICE_NAME,
    runtime: {
      dataDir: runtimeDataDir,
      costLedgerPath,
      browserSessionDir,
      browserPoolMaxInstances: env.BROWSER_POOL_MAX_INSTANCES,
      browserPoolMaxRequestsPerInstance: env.BROWSER_POOL_MAX_REQUESTS_PER_INSTANCE,
      browserPoolNavTimeoutMs: env.BROWSER_POOL_NAV_TIMEOUT_MS,
      backpressureInitialConcurrency: env.BACKPRESSURE_INITIAL_CONCURRENCY,
      backpressureMaxConcurrency: env.BACKPRESSURE_MAX_CONCURRENCY,
    },
    hunter: {
      apiKey: env.HUNTER_API_KEY,
      enabled: env.HUNTER_ENABLED,
    },
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId: env.TELEGRAM_CHAT_ID,
    },
    features: {
      googleBrowserEnabled: env.DISCOVERY_GOOGLE_BROWSER_ENABLED,
      aiVariantsEnabled: env.DISCOVERY_AI_VARIANTS_ENABLED,
      perplexityEnabled: env.DISCOVERY_PERPLEXITY_ENABLED,
    },
    browserEngineLimits: {
      maxQueriesPerSec: env.GOOGLE_BROWSER_MAX_QUERIES_PER_SEC,
      maxQueriesPerCompany: env.GOOGLE_BROWSER_MAX_QUERIES_PER_COMPANY,
      captchaAutoDisableThreshold: env.GOOGLE_BROWSER_CAPTCHA_AUTO_DISABLE_THRESHOLD,
    },
    budget: {
      maxCostPerCompanyEur: env.MAX_COST_PER_COMPANY_EUR,
    },
    costing: {
      localBrowserNavCostEur: env.LOCAL_BROWSER_NAV_COST_EUR,
      localOracleFetchCostEur: env.LOCAL_ORACLE_FETCH_COST_EUR,
    },
  } as const;
}

let cachedConfig: AppConfig | null = null;

export function initializeRuntimeConfig(): AppConfig {
  cachedConfig = buildConfig(parseEnv(process.env));
  return cachedConfig;
}

export function resetRuntimeConfigForTests(): void {
  cachedConfig = null;
}

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = buildConfig(parseEnv(process.env));
  }

  return cachedConfig;
}

export type AppConfig = ReturnType<typeof buildConfig>;

export const config: AppConfig = new Proxy({} as AppConfig, {
  get(_target, prop, receiver) {
    return Reflect.get(getConfig(), prop, receiver);
  },
  has(_target, prop) {
    return Reflect.has(getConfig(), prop);
  },
  ownKeys() {
    return Reflect.ownKeys(getConfig());
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Object.getOwnPropertyDescriptor(getConfig(), prop);
  },
});
