import { describe, expect, it } from 'vitest';
import { XHRInterceptor } from '../../src/scraper/core/browser/xhr_interceptor';

describe('XHRInterceptor', () => {
  it('detects GraphQL request/response metadata', () => {
    const metadata = XHRInterceptor.detectGraphQLPayload(
      'https://example.com/graphql',
      {
        operationName: 'CompanyProfile',
        variables: { id: '123' },
        extensions: { persistedQuery: { sha256Hash: 'abc' } },
      },
      {
        data: { company: { id: '123' } },
      }
    );

    expect(metadata).toEqual({
      operationName: 'CompanyProfile',
      variables: { id: '123' },
      hasPersistedQuery: true,
      hasErrors: false,
    });
  });
});
