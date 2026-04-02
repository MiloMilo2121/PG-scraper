import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { chromium, LaunchOptions } from 'playwright';
import { createObjectCsvWriter } from 'csv-writer';
import { CompanyInput } from './types';
import { PROVINCE_CODES, PROVINCE_NAME_TO_CODE } from './data/pg_categories';
import { Logger } from './utils/logger';
import { proxyManager } from './core/browser/proxy_manager';
import { ImmobiliareAgencyProvider } from './providers/immobiliare_agencies';

dotenv.config();

const OUTPUT_DIR = 'output/campaigns';
const LOMBARDIA_PROVINCES = ['BG', 'BS', 'CO', 'CR', 'LC', 'LO', 'MN', 'MB', 'MI', 'PV', 'SO', 'VA'];

interface CliOptions {
  provinceCodes: string[];
  maxPagesPerProvince?: number;
  includeDetails: boolean;
  outputFile?: string;
}

function parseCli(argv: string[]): CliOptions {
  const provincesArg = argv.find((arg) => arg.startsWith('--provinces='))?.split('=').slice(1).join('=');
  const lombardia = argv.includes('--lombardia');
  const pagesArg = argv.find((arg) => arg.startsWith('--max-pages-per-province='))?.split('=').slice(1).join('=');
  const outputArg = argv.find((arg) => arg.startsWith('--output='))?.split('=').slice(1).join('=');
  const includeDetails = !argv.includes('--skip-details');

  const rawProvinces = lombardia
    ? LOMBARDIA_PROVINCES
    : (provincesArg || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

  if (rawProvinces.length === 0) {
    throw new Error('Missing --lombardia or --provinces=MI,BG,...');
  }

  const provinceCodes = rawProvinces.map((province) => {
    const upper = province.toUpperCase();
    if (PROVINCE_CODES[upper]) return upper;
    const resolved = PROVINCE_NAME_TO_CODE[province];
    return resolved || upper;
  });

  const parsedMaxPages = pagesArg ? Number.parseInt(pagesArg, 10) : undefined;
  return {
    provinceCodes,
    maxPagesPerProvince: Number.isFinite(parsedMaxPages) && parsedMaxPages! > 0 ? parsedMaxPages : undefined,
    includeDetails,
    outputFile: outputArg,
  };
}

function resolveProvinceName(code: string): string {
  return PROVINCE_CODES[code] || code;
}

function createCsvWriter(outputFile: string) {
  return createObjectCsvWriter({
    path: outputFile,
    header: [
      { id: 'company_name', title: 'company_name' },
      { id: 'address', title: 'address' },
      { id: 'city', title: 'city' },
      { id: 'province', title: 'province' },
      { id: 'zip_code', title: 'zip_code' },
      { id: 'region', title: 'region' },
      { id: 'phone', title: 'phone' },
      { id: 'email', title: 'email' },
      { id: 'website', title: 'website' },
      { id: 'category', title: 'category' },
      { id: 'source', title: 'source' },
      { id: 'immobiliare_url', title: 'immobiliare_url' },
      { id: 'portal_association', title: 'portal_association' },
      { id: 'portal_years_on_immobiliare', title: 'portal_years_on_immobiliare' },
      { id: 'portal_quality_score', title: 'portal_quality_score' },
      { id: 'portal_announcements', title: 'portal_announcements' },
      { id: 'portal_description', title: 'portal_description' },
    ],
  });
}

async function main(): Promise<void> {
  const { provinceCodes, maxPagesPerProvince, includeDetails, outputFile } = parseCli(process.argv.slice(2));
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const finalOutput = outputFile || path.join(OUTPUT_DIR, `campaign_immobiliare_lombardia_${timestamp}.csv`);
  fs.mkdirSync(path.dirname(finalOutput), { recursive: true });

  const launchOptions: LaunchOptions = {
    headless: process.env.HEADLESS !== 'false',
  };

  const proxy = proxyManager.getPlaywrightProxy('https://www.immobiliare.it');
  if (proxy?.server) {
    launchOptions.proxy = proxy;
  }

  Logger.info(`[Immobiliare] Starting scrape for ${provinceCodes.join(', ')} | details=${includeDetails ? 'on' : 'off'} | maxPages=${maxPagesPerProvince || 'auto'}`);
  const browser = await chromium.launch(launchOptions);

  try {
    const results: CompanyInput[] = [];
    for (const provinceCode of provinceCodes) {
      const provinceName = resolveProvinceName(provinceCode);
      const companies = await ImmobiliareAgencyProvider.scrapeProvince(browser, provinceName, provinceCode, {
        maxPages: maxPagesPerProvince,
        includeDetails,
      });
      Logger.info(`[Immobiliare] ${provinceName}: ${companies.length} agencies`);
      results.push(...companies);
    }

    const writer = createCsvWriter(finalOutput);
    await writer.writeRecords(results);
    Logger.info(`[Immobiliare] Finished. Wrote ${results.length} rows to ${finalOutput}`);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  Logger.error('[Immobiliare] Fatal error', (error as Error).message);
  process.exit(1);
});
