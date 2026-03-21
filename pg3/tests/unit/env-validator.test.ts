import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvValidator as EnricherEnvValidator } from '../../src/enricher/utils/env_validator';
import { Logger as EnricherLogger } from '../../src/enricher/utils/logger';
import { EnvValidator as ScraperEnvValidator } from '../../src/scraper/utils/env_validator';
import { Logger as ScraperLogger } from '../../src/scraper/utils/logger';

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }

  Object.assign(process.env, ORIGINAL_ENV);
}

describe('EnvValidator', () => {
  beforeEach(() => {
    restoreEnv();
    vi.restoreAllMocks();

    vi.spyOn(EnricherLogger, 'error').mockImplementation(() => undefined);
    vi.spyOn(EnricherLogger, 'warn').mockImplementation(() => undefined);
    vi.spyOn(EnricherLogger, 'info').mockImplementation(() => undefined);
    vi.spyOn(ScraperLogger, 'error').mockImplementation(() => undefined);
    vi.spyOn(ScraperLogger, 'warn').mockImplementation(() => undefined);
    vi.spyOn(ScraperLogger, 'info').mockImplementation(() => undefined);
  });

  afterAll(() => {
    restoreEnv();
  });

  it('throws when remote browser mode has no endpoint', () => {
    process.env.BROWSER_MODE = 'remote';
    delete process.env.REMOTE_BROWSER_ENDPOINT;

    expect(() => EnricherEnvValidator.validate()).toThrow('REMOTE_BROWSER_ENDPOINT');
    expect(() => ScraperEnvValidator.validate()).toThrow('REMOTE_BROWSER_ENDPOINT');
  });

  it('returns warnings without failing in local mode', () => {
    process.env.BROWSER_MODE = 'local';
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_STREET_VIEW_KEY;
    delete process.env.ANTIGRAVITY_URL;

    const enricherReport = EnricherEnvValidator.validate();
    const scraperReport = ScraperEnvValidator.validate();

    expect(enricherReport.missing).toEqual([]);
    expect(scraperReport.missing).toEqual([]);
    expect(enricherReport.warnings.length).toBeGreaterThan(0);
    expect(scraperReport.warnings.length).toBeGreaterThan(0);
  });
});
