
import * as dotenv from 'dotenv';
dotenv.config();

export const config = {
    browser: {
        headless: process.env.HEADLESS !== 'false', // Default true
        maxConcurrency: parseInt(process.env.MAX_CONCURRENCY || '5', 10),
        chromePath: process.env.CHROME_PATH || undefined,
        mode: (process.env.BROWSER_MODE || 'local') as 'local' | 'remote',
        remoteEndpoint: process.env.REMOTE_BROWSER_ENDPOINT || '',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        geneticEvolutionInterval: parseInt(process.env.GENETIC_EVOLUTION_INTERVAL || '50', 10),
    },
    scraping: {
        timeout: parseInt(process.env.SCRAPING_TIMEOUT || '30000', 10),
        maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
        pageLoadTimeout: parseInt(process.env.PAGE_LOAD_TIMEOUT || '60000', 10),
    },
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
    },
    llm: {
        apiKey: process.env.OPENAI_API_KEY || '',
        model: process.env.LLM_MODEL || 'gpt-4o',
    },
    google: {
        streetViewKey: process.env.GOOGLE_STREET_VIEW_KEY || '',
    },
    neo4j: {
        uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
        user: process.env.NEO4J_USER || 'neo4j',
        password: process.env.NEO4J_PASSWORD || 'password',
    },
    proxy: {
        residentialUrl: process.env.PROXY_RESIDENTIAL_URL || '',
        datacenterUrl: process.env.PROXY_DATACENTER_URL || '',
        failureCooldownMs: parseInt(process.env.PROXY_FAILURE_COOLDOWN_MS || '300000', 10),
    }
};
