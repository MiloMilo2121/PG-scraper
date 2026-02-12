import * as dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

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

  // 🤖 AI / LLM
  OPENAI_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('gpt-4o'),
  AI_MODEL_FAST: z.string().default('gpt-4o-mini'),
  AI_MODEL_SMART: z.string().default('gpt-4o'),
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

  // 🛡️ PROXY / SCRAPE.DO
  SCRAPE_DO_TOKEN: z.string().optional(),
  SCRAPE_DO_API_URL: z.string().default('https://api.scrape.do'),
  SCRAPE_DO_PROXY_HOST: z.string().default('proxy.scrape.do:8080'),
  SCRAPE_DO_GEO_CODE: z.string().default('it'),
  SCRAPE_DO_SUPER: BooleanString.default(false),
  SCRAPE_DO_RENDER_DEFAULT: BooleanString.default(false),
  SCRAPE_DO_TIMEOUT_MS: z.coerce.number().default(20000),
  SCRAPE_DO_ENFORCE: BooleanString.default(false),
  PROXY_FAILURE_COOLDOWN_MS: z.coerce.number().min(1000).default(300000), // 5 min

  // 📍 DISCOVERY THRESHOLDS
  DISCOVERY_THRESHOLD_WAVE1: z.coerce.number().min(0).max(1).default(0.85),
  DISCOVERY_THRESHOLD_WAVE2: z.coerce.number().min(0).max(1).default(0.75),
  DISCOVERY_THRESHOLD_WAVE3: z.coerce.number().min(0).max(1).default(0.70),
  DISCOVERY_THRESHOLD_MIN_VALID: z.coerce.number().min(0).max(1).default(0.60),

  // ⚡ PERFORMANCE & QUEUE
  CONCURRENCY_LIMIT: z.coerce.number().min(1).max(100).default(10),
  RETRY_ATTEMPTS: z.coerce.number().min(1).max(10).default(3),
  RETRY_DELAY_MS: z.coerce.number().min(100).default(1000),
  QUEUE_BATCH_SIZE: z.coerce.number().min(1).max(1000).default(100),
  REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().min(500).default(5000),
  REDIS_CONNECT_RETRIES: z.coerce.number().min(0).default(5),
  SCHEDULER_LOCK_TTL_MS: z.coerce.number().min(30000).default(900000), // 15 min

  // 🏃 RUNNER
  RUNNER_CONCURRENCY_LIMIT: z.coerce.number().min(1).max(200).default(25),
  RUNNER_MEMORY_WARN_MB: z.coerce.number().min(256).default(20000),
  RUNNER_PROGRESS_LOG_EVERY: z.coerce.number().min(1).default(20),

  // 🧠 KNOWLEDGE GRAPH & INTERNAL
  NEO4J_URI: z.string().default('bolt://localhost:7687'),
  NEO4J_USER: z.string().default('neo4j'),
  NEO4J_PASSWORD: z.string().default('password'),
  GOOGLE_STREET_VIEW_KEY: z.string().optional(),

  // 📱 NOTIFICATIONS
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  // 🧩 MISC
  AI_CACHE_MAX_ENTRIES: z.coerce.number().min(10).default(500),
  AI_CACHE_TTL_MS: z.coerce.number().min(1000).default(3600000), // 1 hour
  DEDUPLICATOR_MAX_COMPANIES: z.coerce.number().min(1000).default(100000),
  CAPTCHA_MAX_ATTEMPTS: z.coerce.number().min(1).default(30),

  // JINA
  JINA_API_KEY: z.string().optional(),
  JINA_ENABLED: BooleanString.default(false),
  JINA_TIMEOUT_MS: z.coerce.number().min(5000).default(20000),
  JINA_MAX_CONTENT_LENGTH: z.coerce.number().min(1000).default(8000),
});

// Parse and validate process.env
const _env = EnvSchema.safeParse(process.env);

if (!_env.success) {
  console.error("❌ INVALID CONFIGURATION:");
  _env.error.issues.forEach((issue) => {
    console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
  });
  process.exit(1); // Law 106: Fail fast
}

const env = _env.data;

/**
 * Helper to derive Redis connection details
 */
function deriveRedis() {
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

export const config = {
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
  redis: deriveRedis(),
  llm: {
    apiKey: env.OPENAI_API_KEY,
    model: env.LLM_MODEL,
    fastModel: env.AI_MODEL_FAST,
    smartModel: env.AI_MODEL_SMART,
    maxTokens: env.AI_MAX_TOKENS,
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
    redisConnectTimeoutMs: env.REDIS_CONNECT_TIMEOUT_MS,
    redisConnectRetries: env.REDIS_CONNECT_RETRIES,
    schedulerLockTtlMs: env.SCHEDULER_LOCK_TTL_MS,
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
  },
  ai: {
    cacheMaxEntries: env.AI_CACHE_MAX_ENTRIES,
    cacheTtlMs: env.AI_CACHE_TTL_MS,
  },
  deduplication: {
    maxKnownCompanies: env.DEDUPLICATOR_MAX_COMPANIES,
  },
  proxy: {
    failureCooldownMs: env.PROXY_FAILURE_COOLDOWN_MS,
  },
  scrapeDo: {
    token: env.SCRAPE_DO_TOKEN,
    apiUrl: env.SCRAPE_DO_API_URL,
    proxyHost: env.SCRAPE_DO_PROXY_HOST,
    geoCode: env.SCRAPE_DO_GEO_CODE,
    super: env.SCRAPE_DO_SUPER,
    renderDefault: env.SCRAPE_DO_RENDER_DEFAULT,
    timeoutMs: env.SCRAPE_DO_TIMEOUT_MS,
    enforce: env.SCRAPE_DO_ENFORCE,
  },
  captcha: {
    maxAttempts: env.CAPTCHA_MAX_ATTEMPTS,
  },
  health: {
    port: env.HEALTH_PORT,
  },
  sqlitePath: env.SQLITE_PATH,
  serviceName: env.SERVICE_NAME,
  telegram: {
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
  },
  jina: {
    apiKey: env.JINA_API_KEY,
    enabled: env.JINA_ENABLED,
    timeoutMs: env.JINA_TIMEOUT_MS,
    maxContentLength: env.JINA_MAX_CONTENT_LENGTH,
  }
} as const;

export type AppConfig = typeof config;
