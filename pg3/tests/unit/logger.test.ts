import { describe, expect, it } from 'vitest';
import { Logger, ErrorCategory } from '../../src/enricher/utils/logger';

describe('Logger.categorizeError', () => {
  it('categorizes network errors', () => {
    expect(Logger.categorizeError(new Error('ETIMEDOUT socket hang up'))).toBe(ErrorCategory.NETWORK);
  });

  it('categorizes browser errors', () => {
    expect(Logger.categorizeError(new Error('Puppeteer target closed unexpectedly'))).toBe(ErrorCategory.BROWSER);
  });

  it('categorizes parsing errors', () => {
    expect(Logger.categorizeError(new Error('Unexpected token in JSON at position 2'))).toBe(ErrorCategory.PARSING);
  });

  it('categorizes validation errors', () => {
    expect(Logger.categorizeError(new Error('Validation failed: zod invalid input'))).toBe(ErrorCategory.VALIDATION);
  });

  it('categorizes auth errors', () => {
    expect(Logger.categorizeError(new Error('429 rate limit exceeded api key'))).toBe(ErrorCategory.AUTH);
  });

  it('falls back to logic errors', () => {
    expect(Logger.categorizeError(new Error('unhandled branch'))).toBe(ErrorCategory.LOGIC);
  });
});
