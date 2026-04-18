import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

const mocks = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  agentMock: vi.fn(),
  proxyAgentMock: vi.fn(),
  fetchHtmlStealthMock: vi.fn(),
}));

vi.mock('undici', () => ({
  fetch: mocks.fetchMock,
  Agent: mocks.agentMock.mockImplementation((options: unknown) => ({ options })),
  ProxyAgent: mocks.proxyAgentMock.mockImplementation((options: unknown) => ({ options })),
}));

vi.mock('../../src/enricher/utils/oracle_client', () => ({
  OracleClient: {
    fetchHtmlStealth: mocks.fetchHtmlStealthMock,
  },
}));

function makeResponse(status: number, body: string, url: string) {
  return {
    status,
    url,
    headers: {
      entries: () => [ ['content-type', 'text/html'] ][Symbol.iterator](),
    },
    text: async () => body,
  } as any;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
  mocks.fetchMock.mockReset();
  mocks.agentMock.mockClear();
  mocks.proxyAgentMock.mockClear();
  mocks.fetchHtmlStealthMock.mockReset();
});

describe('ScraperClient auto ladder', () => {
  it('escalates direct -> oracle and stops before BrightData when oracle succeeds', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      BRIGHTDATA_WEB_UNLOCKER_URL: 'https://proxy.local:8443',
    };

    mocks.fetchMock.mockResolvedValueOnce(makeResponse(403, '<html>blocked</html>', 'https://target.test'));
    mocks.fetchHtmlStealthMock.mockResolvedValueOnce({
      success: true,
      html: `<html>${'oracle ok '.repeat(40)}</html>`,
    });

    const { ScraperClient } = await import('../../src/enricher/utils/scraper_client');
    const result = await ScraperClient.fetchHtml('https://target.test', { mode: 'auto' });

    expect(result.via).toBe('oracle');
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.fetchHtmlStealthMock).toHaveBeenCalledTimes(1);
    expect(mocks.proxyAgentMock).not.toHaveBeenCalled();
  });

  it('falls through to BrightData after direct and oracle block', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      BRIGHTDATA_WEB_UNLOCKER_URL: 'https://proxy.local:8443',
    };

    mocks.fetchMock
      .mockResolvedValueOnce(makeResponse(403, '<html>blocked</html>', 'https://target.test'))
      .mockResolvedValueOnce(makeResponse(200, '<html>brightdata ok</html>', 'https://target.test'));
    mocks.fetchHtmlStealthMock.mockResolvedValueOnce({ success: false, html: '<html>oracle blocked</html>' });

    const { ScraperClient } = await import('../../src/enricher/utils/scraper_client');
    const result = await ScraperClient.fetchHtml('https://target.test', { mode: 'auto' });

    expect(result.via).toBe('brightdata');
    expect(mocks.fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.fetchHtmlStealthMock).toHaveBeenCalledTimes(1);
    expect(mocks.proxyAgentMock).toHaveBeenCalledTimes(1);
    expect(mocks.proxyAgentMock.mock.calls[0][0].connect).toBeUndefined();
  });
});
