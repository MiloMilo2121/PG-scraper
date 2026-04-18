import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  browserIsConnected: vi.fn(),
  browserNewContext: vi.fn(),
  browserClose: vi.fn(),
  contextNewPage: vi.fn(),
  contextRoute: vi.fn(),
  contextStorageState: vi.fn(),
  contextClose: vi.fn(),
  pageGoto: vi.fn(),
  pageContent: vi.fn(),
  pageUrl: vi.fn(),
}));

vi.mock('playwright', () => ({
  chromium: {
    launch: mocks.launch,
  },
}));

describe('BrowserPool TLS policy', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    mocks.launch.mockReset();
    mocks.browserIsConnected.mockReset();
    mocks.browserNewContext.mockReset();
    mocks.browserClose.mockReset();
    mocks.contextNewPage.mockReset();
    mocks.contextRoute.mockReset();
    mocks.contextStorageState.mockReset();
    mocks.contextClose.mockReset();
    mocks.pageGoto.mockReset();
    mocks.pageContent.mockReset();
    mocks.pageUrl.mockReset();

    const page = {
      goto: mocks.pageGoto.mockResolvedValue({ status: () => 200 }),
      content: mocks.pageContent.mockResolvedValue('<html><body>ok</body></html>'),
      url: mocks.pageUrl.mockReturnValue('https://allowed.example.com/path'),
    };
    const context = {
      newPage: mocks.contextNewPage.mockResolvedValue(page),
      route: mocks.contextRoute.mockResolvedValue(undefined),
      storageState: mocks.contextStorageState.mockResolvedValue(undefined),
      close: mocks.contextClose.mockResolvedValue(undefined),
    };
    const browser = {
      isConnected: mocks.browserIsConnected.mockReturnValue(true),
      newContext: mocks.browserNewContext.mockResolvedValue(context),
      close: mocks.browserClose.mockResolvedValue(undefined),
    };

    mocks.launch.mockResolvedValue(browser);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('keeps HTTPS verification on unless the URL is allowlisted', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      TLS_RELAX_ENABLED: 'true',
      TLS_RELAX_ALLOWLIST: 'allowed.example.com',
    };

    const { BrowserPool } = await import('../../src/shared-runtime/browser/BrowserPool');
    const { CostLedger } = await import('../../src/shared-runtime/budget/CostLedger');

    const ledger = new CostLedger({ persistToDisk: false });
    const poolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browserpool-'));
    const pool = new BrowserPool({
      ledger,
      sessionStateDir: poolDir,
      maxInstances: 1,
      maxRequestsPerInstance: 1,
    });

    try {
      await pool.navigateSafe('https://allowed.example.com/path');
      expect(mocks.browserNewContext).toHaveBeenCalledTimes(1);
      expect(mocks.browserNewContext.mock.calls[0][0].ignoreHTTPSErrors).toBe(true);
    } finally {
      ledger.cleanup();
      fs.rmSync(poolDir, { recursive: true, force: true });
    }
  });

  it('keeps HTTPS verification strict when the URL is not allowlisted', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      TLS_RELAX_ENABLED: 'true',
      TLS_RELAX_ALLOWLIST: 'different.example.com',
    };

    const { BrowserPool } = await import('../../src/shared-runtime/browser/BrowserPool');
    const { CostLedger } = await import('../../src/shared-runtime/budget/CostLedger');

    const ledger = new CostLedger({ persistToDisk: false });
    const poolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browserpool-'));
    const pool = new BrowserPool({
      ledger,
      sessionStateDir: poolDir,
      maxInstances: 1,
      maxRequestsPerInstance: 1,
    });

    try {
      await pool.navigateSafe('https://allowed.example.com/path');
      expect(mocks.browserNewContext).toHaveBeenCalledTimes(1);
      expect(mocks.browserNewContext.mock.calls[0][0].ignoreHTTPSErrors).toBe(false);
    } finally {
      ledger.cleanup();
      fs.rmSync(poolDir, { recursive: true, force: true });
    }
  });
});
