import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_CWD = process.cwd();

function writeCache(tempDir: string, payload: Record<string, string[]>) {
  const dataDir = path.join(tempDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'municipalities_cache.json'),
    JSON.stringify(payload, null, 2),
    'utf8',
  );
}

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  vi.resetModules();
  vi.unmock('../../src/shared-runtime/ai/LLMService');
});

describe('MunicipalitySplitter', () => {
  it('uses normalized cache aliases for province code lookups', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'municipality-splitter-'));
    writeCache(tempDir, {
      mi: ['Milano', 'Sesto San Giovanni', 'Cinisello Balsamo', 'Legnano', 'Rho'],
    });

    process.chdir(tempDir);
    vi.resetModules();

    const { MunicipalitySplitter } = await import('../../src/scraper/ai/municipality_splitter');

    await expect(MunicipalitySplitter.getMunicipalities('MI')).resolves.toEqual([
      'Milano',
      'Sesto San Giovanni',
      'Cinisello Balsamo',
      'Legnano',
      'Rho',
    ]);
    await expect(MunicipalitySplitter.getMunicipalities('Milano')).resolves.toEqual([
      'Milano',
      'Sesto San Giovanni',
      'Cinisello Balsamo',
      'Legnano',
      'Rho',
    ]);
  });

  it('falls back to the resolved province when the LLM path fails without cache', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'municipality-splitter-'));
    process.chdir(tempDir);
    vi.resetModules();

    vi.doMock('../../src/shared-runtime/ai/LLMService', () => ({
      LLMService: {
        complete: vi.fn().mockRejectedValue(new Error('boom')),
      },
    }));

    const { MunicipalitySplitter } = await import('../../src/scraper/ai/municipality_splitter');

    await expect(MunicipalitySplitter.getMunicipalities('MI')).resolves.toEqual(['Milano']);
  });
});
