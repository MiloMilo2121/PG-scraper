
import { Logger } from './logger';

export interface EnvValidationReport {
    missing: string[];
    warnings: string[];
}

export class EnvValidator {
    static validate(): EnvValidationReport {
        const missing: string[] = [];
        const warnings: string[] = [];

        // Critical Keys (System might fail without them)
        if (!process.env.OPENAI_API_KEY) warnings.push('OPENAI_API_KEY is missing. AI Validation/Selector Healer will be disabled.');
        if (!process.env.GOOGLE_STREET_VIEW_KEY) warnings.push('GOOGLE_STREET_VIEW_KEY is missing. Satellite Verification will be disabled.');
        if (!process.env.ANTIGRAVITY_URL) warnings.push('ANTIGRAVITY_URL is missing. Live Dashboard updates will be disabled.');

        // Required for Remote Browser (if mode is remote)
        if (process.env.BROWSER_MODE === 'remote' && !process.env.REMOTE_BROWSER_ENDPOINT) {
            missing.push('REMOTE_BROWSER_ENDPOINT (Required for BROWSER_MODE=remote)');
        }

        if (warnings.length > 0) {
            Logger.warn('⚠️ ENV VALIDATION WARNINGS:');
            warnings.forEach(w => Logger.warn(`   - ${w}`));
        }

        if (missing.length > 0) {
            Logger.error('🚨 ENV VALIDATION FAILED (Missing Required Keys):');
            missing.forEach(m => Logger.error(`   - ${m}`));
            throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
        }

        Logger.info('✅ Environment Variables Validated.');
        return { missing, warnings };
    }
}
