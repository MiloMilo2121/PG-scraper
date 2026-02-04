import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export interface Config {
    scoring: {
        weights: {
            s1_phone_exact_match: number;
            s2_address_high_match: number;
            s3_name_high_match: number;
            s4_vat_found: number;
            c1_email_domain_found: number;
            c2_sd_org_match: number;
            c3_corporate_signals: number;
            c4_has_contact_page: number;
            c5_https_ok: number;
        };
        allow_social_fallback?: boolean;
        penalties: {
            p1_bad_site_type: number;
            p2_dns_fail: number;
            p3_http_fail: number;
            p4_name_low_match: number;
            p5_address_low_match: number;
            p6_contradiction: number;
        };
    };
    thresholds: {
        ok_score: number;
        ok_margin: number;
        high_risk_score: number;
        high_risk_margin: number;
        phone_frequency_limit: number;
    };
    fetcher: {
        timeout_ms: number;
        retries: number;
        backoff_ms: number;
        user_agent: string;
    };
    crawl_budget: {
        max_pages_per_domain: number;
        max_candidates_per_row: number;
    };
    lists: {
        directory_domains: string[];
        social_domains: string[];
        marketplace_domains: string[];
        parked_indicators: string[];
    };
    system: {
        concurrency: number;
    };
    openai?: {
        enabled: boolean;
        fallback_threshold: number;
        min_ai_confidence: number;
    };
}

let configInstance: Config | null = null;

export const loadConfig = (configPath?: string): Config => {
    if (configInstance) return configInstance;

    const validPath = configPath || path.join(__dirname, '../../src/config/default.yaml');
    const fileContents = fs.readFileSync(validPath, 'utf8');
    configInstance = yaml.load(fileContents) as Config;

    return configInstance;
};

export const getConfig = (): Config => {
    if (!configInstance) {
        loadConfig(); // Auto-load default
    }
    if (!configInstance) {
        throw new Error('Config failed to load.');
    }
    return configInstance;
};
