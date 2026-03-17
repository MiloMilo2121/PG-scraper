import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { OracleClient } from '../../src/enricher/utils/oracle_client';

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

describe('OracleClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ORACLE_BASE_URL;
    delete process.env.ORACLE_API_BASE_URL;
    delete process.env.ORACLE_HOST;
    delete process.env.ORACLE_PORT;
    delete process.env.ORACLE_PROTOCOL;
  });

  it('uses ORACLE_BASE_URL when explicitly configured', async () => {
    process.env.ORACLE_BASE_URL = 'http://10.0.0.5:8123/api/v1/';
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        url: 'https://example.com',
        html: '<html></html>',
        markdown: '',
        success: true,
        error: null,
      },
    } as any);

    await OracleClient.fetchHtmlStealth('https://example.com');

    expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
      'http://10.0.0.5:8123/api/v1/extract',
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('builds the base URL from ORACLE_HOST and ORACLE_PORT when no explicit base URL is set', async () => {
    process.env.ORACLE_HOST = 'oracle.internal';
    process.env.ORACLE_PORT = '9001';
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        url: 'https://example.com',
        html: '<html></html>',
        markdown: '',
        success: true,
        error: null,
      },
    } as any);

    await OracleClient.fetchHtmlStealth('https://example.com');

    expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
      'http://oracle.internal:9001/api/v1/extract',
      expect.any(Object),
      expect.any(Object)
    );
  });
});
