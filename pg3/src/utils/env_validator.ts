
/**
 * Shared environment variable validator.
 * Used by both the scraper and enricher entry points.
 * Exits the process immediately when required keys are absent so misconfigured
 * containers fail fast instead of producing silent failures at runtime.
 */
export class EnvValidator {
    static validate() {
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
            console.warn('⚠️ ENV VALIDATION WARNINGS:');
            warnings.forEach(w => console.warn(`   - ${w}`));
        }

        if (missing.length > 0) {
            console.error('🚨 ENV VALIDATION FAILED (Missing Required Keys):');
            missing.forEach(m => console.error(`   - ${m}`));
            process.exit(1);
        } else {
            console.info('✅ Environment Variables Validated.');
        }
    }
}
