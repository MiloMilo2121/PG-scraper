export interface RuntimeLogger {
  info(message: string, context?: unknown): void;
  warn(message: string, context?: unknown): void;
  error(message: string, context?: unknown): void;
}

export interface EnvValidationReport {
  missing: string[];
  warnings: string[];
}

export function validateRuntimeEnv(logger: RuntimeLogger): EnvValidationReport {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!process.env.OPENAI_API_KEY) warnings.push('OPENAI_API_KEY is missing. AI Validation/Selector Healer will be disabled.');
  if (!process.env.GOOGLE_STREET_VIEW_KEY) warnings.push('GOOGLE_STREET_VIEW_KEY is missing. Satellite Verification will be disabled.');
  if (!process.env.ANTIGRAVITY_URL) warnings.push('ANTIGRAVITY_URL is missing. Live Dashboard updates will be disabled.');

  if (process.env.BROWSER_MODE === 'remote' && !process.env.REMOTE_BROWSER_ENDPOINT) {
    missing.push('REMOTE_BROWSER_ENDPOINT (Required for BROWSER_MODE=remote)');
  }

  if (warnings.length > 0) {
    logger.warn('⚠️ ENV VALIDATION WARNINGS:');
    warnings.forEach((warning) => logger.warn(`   - ${warning}`));
  }

  if (missing.length > 0) {
    logger.error('🚨 ENV VALIDATION FAILED (Missing Required Keys):');
    missing.forEach((entry) => logger.error(`   - ${entry}`));
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  logger.info('✅ Environment Variables Validated.');
  return { missing, warnings };
}
