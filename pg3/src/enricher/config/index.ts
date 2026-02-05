/**
 * 🔒 ENVIRONMENT CONFIGURATION
 * Task 7: Centralized .env with Zod Validation
 * 
 * LAW #7: The application must REFUSE to start if any required variable is missing.
 */

import { z } from 'zod';
import * as dotenv from 'dotenv';

// Load .env file
dotenv.config();

/**
 * 📋 CONFIG SCHEMA - All Magic Numbers Live Here
 */
const ConfigSchema = z.object({
    // 🔑 API Keys
    OPENAI_API_KEY: z.string().min(1, 'OpenAI API Key is required'),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_CHAT_ID: z.string().optional(),

    // 🌐 Proxy Configuration
    PROXY_RESIDENTIAL_URL: z.string().url().optional(),
    PROXY_DATACENTER_URL: z.string().url().optional(),

    // 🗄️ Database
    SQLITE_PATH: z.string().default('./data/antigravity.db'),
    REDIS_URL: z.string().url().default('redis://localhost:6379'),

    // ⚙️ Concurrency Settings
    CONCURRENCY_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
    BROWSER_TIMEOUT_MS: z.coerce.number().int().min(5000).max(60000).default(15000),
    PAGE_TIMEOUT_MS: z.coerce.number().int().min(5000).max(60000).default(20000),
    RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    RETRY_DELAY_MS: z.coerce.number().int().min(100).max(10000).default(1000),

    // 🧠 AI Settings
    AI_MODEL_FAST: z.string().default('gpt-4o-mini'),
    AI_MODEL_SMART: z.string().default('gpt-4o'),
    AI_MAX_TOKENS: z.coerce.number().int().min(100).max(4000).default(500),

    // 📊 Thresholds
    MEMORY_WARNING_MB: z.coerce.number().int().default(20000),
    QUEUE_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),

    // 🏷️ Service Identity
    SERVICE_NAME: z.string().default('antigravity-enricher'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * 🚀 Parse and Validate Environment
 * Throws immediately if config is invalid - NO SILENT STARTUP
 */
function loadConfig(): Config {
    const result = ConfigSchema.safeParse(process.env);

    if (!result.success) {
        console.error('\n❌ CONFIGURATION ERROR - REFUSING TO START\n');
        console.error('The following .env variables are missing or invalid:');
        result.error.issues.forEach(issue => {
            console.error(`  • ${issue.path.join('.')}: ${issue.message}`);
        });
        console.error('\nCheck your .env file and try again.\n');
        process.exit(1);
    }

    return result.data;
}

// Export singleton config
export const config = loadConfig();

// Also export individual values for convenience
export const {
    OPENAI_API_KEY,
    REDIS_URL,
    SQLITE_PATH,
    CONCURRENCY_LIMIT,
    BROWSER_TIMEOUT_MS,
    PAGE_TIMEOUT_MS,
    RETRY_ATTEMPTS,
    RETRY_DELAY_MS,
    AI_MODEL_FAST,
    AI_MODEL_SMART,
    MEMORY_WARNING_MB,
    QUEUE_BATCH_SIZE,
    SERVICE_NAME,
    NODE_ENV
} = config;
