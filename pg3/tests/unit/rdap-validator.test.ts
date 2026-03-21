import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.hoisted(() => vi.fn());

vi.mock('undici', () => ({
  request: requestMock,
}));

import { RdapValidator } from '../../src/enricher/core/discovery/rdap_validator';

describe('RdapValidator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestMock.mockResolvedValue({
      statusCode: 200,
      body: {
        json: vi.fn().mockResolvedValue({
          entities: [],
        }),
      },
    });
  });

  it('normalizes full URLs to the registrable hostname before hitting RDAP', async () => {
    await RdapValidator.checkDomainOwnership('https://www.acme.it/contatti?ref=1', {
      company_name: 'ACME S.R.L.',
      piva: '12345678901',
    } as any);

    expect(requestMock).toHaveBeenCalledWith(
      'https://rdap.nic.it/domain/acme.it',
      expect.any(Object),
    );
  });
});
