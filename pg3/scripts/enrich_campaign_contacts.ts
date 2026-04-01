import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import pLimit from 'p-limit';

import { BrowserPool } from '../src/foundation/BrowserPool';
import { InputNormalizer, NormalizedInput } from '../src/foundation/InputNormalizer';
import { PecHunter } from '../src/foundation/PecHunter';
import { CostLedger } from '../src/shared-runtime/budget/CostLedger';
import { PagineGialleHarvester } from '../src/enricher/core/directories/paginegialle';
import { CompanyInput } from '../src/enricher/types';

type CampaignRow = Record<string, string>;

interface EnrichedCampaignRow extends CampaignRow {
  input_website_clean: string;
  pg_official_website: string;
  pg_email: string;
  website_used_for_contacts: string;
  site_email: string;
  site_pec: string;
  final_email: string;
  final_pec: string;
  contact_source: string;
}

interface Summary {
  total_rows: number;
  processed_rows: number;
  rows_with_pg_email: number;
  rows_with_site_email: number;
  rows_with_site_pec: number;
  rows_with_any_email: number;
  rows_with_any_pec: number;
}

const WEBSITE_HOST_DENYLIST = new Set([
  'wa.me',
  'api.whatsapp.com',
  'web.whatsapp.com',
  't.me',
  'telegram.me',
  'g.page',
  'goo.gl',
  'maps.google.com',
  'google.com',
  'paginegialle.it',
  'facebook.com',
  'm.facebook.com',
  'instagram.com',
  'linkedin.com',
  'casa.it',
  'immobiliare.it',
  'idealista.it',
  'wikicasa.it',
  'subito.it',
  'bakeca.it',
]);

function parseArg(flag: string): string | undefined {
  const match = process.argv.slice(2).find((arg) => arg.startsWith(`${flag}=`));
  return match?.slice(flag.length + 1);
}

function normalizeWebsite(value: string | undefined): string | undefined {
  const raw = (value || '').trim();
  if (!raw) {
    return undefined;
  }
  if (/^(mailto:|tel:|javascript:)/i.test(raw)) {
    return undefined;
  }

  const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;

  try {
    const parsed = new URL(withProtocol);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return undefined;
    }

    parsed.hash = '';
    parsed.search = '';
    parsed.username = '';
    parsed.password = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');

    const hostname = parsed.hostname.replace(/^www\./, '');
    if (!hostname || WEBSITE_HOST_DENYLIST.has(hostname)) {
      return undefined;
    }

    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}${parsed.pathname}`;
  } catch {
    return undefined;
  }
}

function uniqueDefined(values: Array<string | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

function toCompanyInput(row: CampaignRow): CompanyInput {
  return {
    company_name: row.company_name || row.name || '',
    city: row.city || undefined,
    province: row.province || undefined,
    zip_code: row.zip_code || undefined,
    region: row.region || undefined,
    address: row.address || undefined,
    phone: row.phone || undefined,
    website: row.website || undefined,
    category: row.category || undefined,
    source: row.source || undefined,
    vat_code: row.vat_code || undefined,
    pg_url: row.pg_url || undefined,
    email: row.email || undefined,
  };
}

async function enrichRow(
  row: CampaignRow,
  normalizer: InputNormalizer,
  pecHunter: PecHunter,
  index: number,
  total: number,
): Promise<EnrichedCampaignRow> {
  const company = toCompanyInput(row);
  const inputWebsite = normalizeWebsite(company.website);
  const normalizedInput = normalizer.normalize({
    company_name: company.company_name,
    city: company.city || '',
    province: company.province || '',
    address: company.address || '',
    phone: company.phone || '',
    email: company.email || '',
    website: inputWebsite || '',
    vat_code: company.vat_code || '',
  });

  const pgHarvest = await PagineGialleHarvester.harvestByPhone(company).catch(() => null);
  const pgWebsite = normalizeWebsite(pgHarvest?.officialWebsite);
  const pgEmail = (pgHarvest?.email || '').trim().toLowerCase();

  const websiteCandidates = uniqueDefined([pgWebsite, inputWebsite]);
  let websiteUsed = '';
  let siteEmail = '';
  let sitePec = '';

  for (const candidate of websiteCandidates) {
    websiteUsed = candidate;
    const contactResult = await pecHunter
      .hunt(String(index), normalizedInput as NormalizedInput, candidate)
      .catch(() => ({ email: null, pec: null }));

    siteEmail = (contactResult.email || '').trim().toLowerCase();
    sitePec = (contactResult.pec || '').trim().toLowerCase();

    if (siteEmail || sitePec) {
      break;
    }
  }

  const finalEmail = siteEmail || pgEmail || '';
  const finalPec = sitePec || '';
  const contactSource = siteEmail || sitePec
    ? 'website'
    : pgEmail
      ? 'paginegialle'
      : '';

  console.log(
    `[contacts] ${index + 1}/${total} ${company.company_name} | pg_email=${pgEmail ? 'yes' : 'no'} | site_email=${siteEmail ? 'yes' : 'no'} | site_pec=${sitePec ? 'yes' : 'no'}`,
  );

  return {
    ...row,
    input_website_clean: inputWebsite || '',
    pg_official_website: pgWebsite || '',
    pg_email: pgEmail,
    website_used_for_contacts: websiteUsed,
    site_email: siteEmail,
    site_pec: sitePec,
    final_email: finalEmail,
    final_pec: finalPec,
    contact_source: contactSource,
  };
}

async function main(): Promise<void> {
  const inputCsv = process.argv[2];
  if (!inputCsv || !fs.existsSync(inputCsv)) {
    throw new Error('Usage: npx ts-node scripts/enrich_campaign_contacts.ts <input.csv> [--limit=N] [--offset=N] [--concurrency=N] [--output=path]');
  }

  const limit = Number.parseInt(parseArg('--limit') || '0', 10) || undefined;
  const offset = Number.parseInt(parseArg('--offset') || '0', 10) || 0;
  const concurrency = Math.max(1, Number.parseInt(parseArg('--concurrency') || '2', 10) || 2);
  const outputCsv = parseArg('--output') || path.join(
    path.dirname(inputCsv),
    `${path.basename(inputCsv, path.extname(inputCsv))}_contacts_enriched.csv`,
  );
  const outputSummary = outputCsv.replace(/\.csv$/i, '_summary.json');

  const rawCsv = fs.readFileSync(inputCsv, 'utf8');
  const rows = parse(rawCsv, { columns: true, skip_empty_lines: true }) as CampaignRow[];
  const slicedRows = rows.slice(offset, limit ? offset + limit : undefined);

  const ledger = new CostLedger({ persistToDisk: false });
  const browserPool = new BrowserPool({
    ledger,
    maxInstances: concurrency,
    navigationTimeout: 8000,
    manageProcessSignals: false,
  });
  const pecHunter = new PecHunter(browserPool);
  const normalizer = new InputNormalizer();
  const limiter = pLimit(concurrency);

  console.log(`[contacts] input=${inputCsv}`);
  console.log(`[contacts] rows=${slicedRows.length} offset=${offset} concurrency=${concurrency}`);

  try {
    const enriched = await Promise.all(
      slicedRows.map((row, index) =>
        limiter(() => enrichRow(row, normalizer, pecHunter, index, slicedRows.length)),
      ),
    );

    const output = stringify(enriched, { header: true });
    fs.writeFileSync(outputCsv, output, 'utf8');

    const summary: Summary = {
      total_rows: rows.length,
      processed_rows: enriched.length,
      rows_with_pg_email: enriched.filter((row) => row.pg_email).length,
      rows_with_site_email: enriched.filter((row) => row.site_email).length,
      rows_with_site_pec: enriched.filter((row) => row.site_pec).length,
      rows_with_any_email: enriched.filter((row) => row.final_email).length,
      rows_with_any_pec: enriched.filter((row) => row.final_pec).length,
    };

    fs.writeFileSync(outputSummary, JSON.stringify(summary, null, 2), 'utf8');

    console.log(`[contacts] wrote ${outputCsv}`);
    console.log(`[contacts] wrote ${outputSummary}`);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browserPool.destroyAll();
  }
}

void main().catch((error) => {
  console.error('[contacts] fatal', error);
  process.exitCode = 1;
});
