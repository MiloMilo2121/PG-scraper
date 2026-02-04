/**
 * ⚙️ PIPELINE CONFIGURATION ⚙️
 * Centralized settings for all enrichment phases
 */

import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config();

export const PipelineConfig = {
    // File Paths
    INPUT_DIR: process.cwd(),
    OUTPUT_DIR: path.join(process.cwd(), 'output'),

    // Concurrency Settings (BALANCED HIGH-PERFORMANCE for 32GB Server)
    CONCURRENCY: {
        PHASE1_WEBSITES: 12,    // Reduced to avoid OpenAI Rate Limits
        PHASE2_FINANCIALS: 10,
        PHASE3_CONTACTS: 8,
        PHASE4_EMAILS: 50,
    },

    // Feature Flags
    FEATURES: {
        ENABLE_COST_TRACKING: true,
        ENABLE_LINKEDIN_SCRAPER: true,
        ENABLE_INFOJOBS_CHECK: true,
        ENABLE_GOOGLE_MAPS_VERIFY: true,
        ENABLE_AI_ARBITER: true,
    },

    // API Limits & Thresholds
    LIMITS: {
        MAX_RETRIES: 3,
        TIMEOUT_MS: 30000,
        GREYLIST_THRESHOLD: 0.30,
    },

    // Scoring Weights (for AI Arbiter)
    SCORING: {
        MIN_CONFIDENCE_TO_ACCEPT: 70,
        MIN_CONFIDENCE_TO_REVIEW: 40,
    },

    // Secrets (loaded from env)
    KEYS: {
        OPENAI: process.env.OPENAI_API_KEY || '',
        APOLLO: process.env.APOLLO_API_KEY || '',
        HUNTER: process.env.HUNTER_API_KEY || '',
        COGNISM: process.env.COGNISM_API_KEY || '',
        WEBHOOK_URL: process.env.WEBHOOK_URL || '',
    },
    // Task 5: Dynamic Proxy List
    PROXIES: process.env.PROXIES ? process.env.PROXIES.split(',') : [],
};
