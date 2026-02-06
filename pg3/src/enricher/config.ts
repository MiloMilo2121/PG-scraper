import * as dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const BrowserModeSchema = z.enum(['local', 'remote']);

const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),

  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),

  LLM_MODEL: z.string().default('gpt-4o'),
  AI_MODEL_FAST: z.string().default('gpt-4o-mini'),
  AI_MODEL_SMART: z.string().default('gpt-4o'),
  AI_MAX_TOKENS: z.string().optional(),

  HEADLESS: z.string().optional(),
  MAX_CONCURRENCY: z.string().optional(),
  BROWSER_MODE: BrowserModeSchema.optional(),
  REMOTE_BROWSER_ENDPOINT: z.string().optional(),
  GENETIC_EVOLUTION_INTERVAL: z.string().optional(),
  CHROME_PATH: z.string().optional(),

  SCRAPING_TIMEOUT: z.string().optional(),
  MAX_RETRIES: z.string().optional(),
  PAGE_LOAD_TIMEOUT: z.string().optional(),

  GOOGLE_STREET_VIEW_KEY: z.string().optional(),

  NEO4J_URI: z.string().default('bolt://localhost:7687'),
  NEO4J_USER: z.string().default('neo4j'),
  NEO4J_PASSWORD: z.string().default('password'),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  CONCURRENCY_LIMIT: z.string().optional(),
  RETRY_ATTEMPTS: z.string().optional(),
  RETRY_DELAY_MS: z.string().optional(),
  QUEUE_BATCH_SIZE: z.string().optional(),
  SQLITE_PATH: z.string().optional(),
  SERVICE_NAME: z.string().optional(),
  NODE_ENV: z.string().optional(),
});

type ParsedEnv = z.infer<typeof EnvSchema>;

function parseInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  opts?: { min?: number; max?: number }
): number {
  if (value === undefined || value === '') {
    return fallback;
  }

  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be an integer`);
  }
  if (opts?.min !== undefined && n < opts.min) {
    throw new Error(`${name} must be >= ${opts.min}`);
  }
  if (opts?.max !== undefined && n > opts.max) {
    throw new Error(`${name} must be <= ${opts.max}`);
  }
  return n;
}

function deriveRedis(env: ParsedEnv): { url: string; host: string; port: number; password?: string } {
  if (env.REDIS_URL && env.REDIS_URL.trim() !== '') {
    const parsed = new URL(env.REDIS_URL);
    const host = parsed.hostname;
    const port = Number.parseInt(parsed.port || '6379', 10);
    const password = parsed.password || env.REDIS_PASSWORD;
    return {
      url: env.REDIS_URL,
      host,
      port,
      password: password || undefined,
    };
  }

  const host = env.REDIS_HOST || 'localhost';
  const port = parseInteger(env.REDIS_PORT, 6379, 'REDIS_PORT', { min: 1, max: 65535 });
  const auth = env.REDIS_PASSWORD ? `:${encodeURIComponent(env.REDIS_PASSWORD)}@` : '';

  return {
    url: `redis://${auth}${host}:${port}`,
    host,
    port,
    password: env.REDIS_PASSWORD || undefined,
  };
}

function loadConfig() {
  const parsed = EnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `- ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = parsed.data;
  const redis = deriveRedis(env);

  const config = {
    browser: {
      headless: env.HEADLESS !== 'false',
      maxConcurrency: parseInteger(env.MAX_CONCURRENCY, 5, 'MAX_CONCURRENCY', { min: 1, max: 100 }),
      chromePath: env.CHROME_PATH || undefined,
      mode: env.BROWSER_MODE || 'local',
      remoteEndpoint: env.REMOTE_BROWSER_ENDPOINT || '',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      geneticEvolutionInterval: parseInteger(
        env.GENETIC_EVOLUTION_INTERVAL,
        50,
        'GENETIC_EVOLUTION_INTERVAL',
        { min: 1 }
      ),
    },
    scraping: {
      timeout: parseInteger(env.SCRAPING_TIMEOUT, 30000, 'SCRAPING_TIMEOUT', { min: 1000 }),
      maxRetries: parseInteger(env.MAX_RETRIES, 3, 'MAX_RETRIES', { min: 1 }),
      pageLoadTimeout: parseInteger(env.PAGE_LOAD_TIMEOUT, 60000, 'PAGE_LOAD_TIMEOUT', { min: 1000 }),
    },
    redis,
    llm: {
      apiKey: env.OPENAI_API_KEY,
      model: env.LLM_MODEL,
      fastModel: env.AI_MODEL_FAST,
      smartModel: env.AI_MODEL_SMART,
      maxTokens: parseInteger(env.AI_MAX_TOKENS, 500, 'AI_MAX_TOKENS', { min: 100, max: 4000 }),
    },
    google: {
      streetViewKey: env.GOOGLE_STREET_VIEW_KEY || '',
    },
    neo4j: {
      uri: env.NEO4J_URI,
      user: env.NEO4J_USER,
      password: env.NEO4J_PASSWORD,
    },
    queue: {
      concurrencyLimit: parseInteger(env.CONCURRENCY_LIMIT, 10, 'CONCURRENCY_LIMIT', { min: 1, max: 100 }),
      retryAttempts: parseInteger(env.RETRY_ATTEMPTS, 3, 'RETRY_ATTEMPTS', { min: 1, max: 10 }),
      retryDelayMs: parseInteger(env.RETRY_DELAY_MS, 1000, 'RETRY_DELAY_MS', { min: 100 }),
      batchSize: parseInteger(env.QUEUE_BATCH_SIZE, 100, 'QUEUE_BATCH_SIZE', { min: 1, max: 1000 }),
    },
    sqlitePath: env.SQLITE_PATH || './data/antigravity.db',
    serviceName: env.SERVICE_NAME || 'antigravity-enricher',
    nodeEnv: env.NODE_ENV || 'development',
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN || '',
      chatId: env.TELEGRAM_CHAT_ID || '',
    },
  };

  if (config.browser.mode === 'remote' && !config.browser.remoteEndpoint) {
    throw new Error('REMOTE_BROWSER_ENDPOINT is required when BROWSER_MODE=remote');
  }

  return config;
}

export const config = loadConfig();
export type AppConfig = typeof config;
