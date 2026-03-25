import { describe, expect, it } from 'vitest';
import { CostRouter } from '../../src/shared-runtime/routing/CostRouter';

type ErrorClassification = {
  errorClass: 'provider_auth' | 'provider_rate_limit' | 'provider_block' | 'semantic_empty' | 'transport' | 'unknown';
  punitive: boolean;
};

function classify(errorMsg?: string, statusCode?: number): ErrorClassification {
  const router = Object.create(CostRouter.prototype) as CostRouter;

  return (router as unknown as {
    classifyError: (errorMsg?: string, statusCode?: number) => ErrorClassification;
  }).classifyError(errorMsg, statusCode);
}

describe('CostRouter error classification', () => {
  it('treats provider 400 and quota failures as non-punitive provider failures', () => {
    expect(classify('Serper API error: 400 Bad Request')).toEqual({
      errorClass: 'provider_auth',
      punitive: false,
    });

    expect(classify('Out of Credits or bad request', 400)).toEqual({
      errorClass: 'provider_auth',
      punitive: false,
    });
  });

  it('keeps real rate limits punitive', () => {
    expect(classify('Rate limit exceeded', 429)).toEqual({
      errorClass: 'provider_rate_limit',
      punitive: true,
    });
  });
});
