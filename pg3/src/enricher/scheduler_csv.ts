import { z } from 'zod';

export interface CSVCompany {
  company_id?: string;
  company_name: string;
  city?: string;
  province?: string;
  zip_code?: string;
  region?: string;
  address?: string;
  phone?: string;
  website?: string;
  category?: string;
  source?: string;
  vat_code?: string;
  pg_url?: string;
  email?: string;
}

export interface CsvLoadDiagnostics {
  totalRows: number;
  acceptedRows: number;
  skippedRows: number;
  skippedMissingCompanyName: number;
  skippedInvalidRows: number;
  aliasHits: number;
  unknownHeaders: Set<string>;
  sampleIssues: string[];
}

type CanonicalCsvField = keyof CSVCompany;

const HEADER_ALIASES: Record<string, CanonicalCsvField> = {
  company_id: 'company_id',
  id: 'company_id',
  azienda_id: 'company_id',
  company_name: 'company_name',
  name: 'company_name',
  ragione_sociale: 'company_name',
  ragionesociale: 'company_name',
  ragione: 'company_name',
  denominazione: 'company_name',
  citta: 'city',
  city: 'city',
  comune: 'city',
  localita: 'city',
  locality: 'city',
  province: 'province',
  provincia: 'province',
  prov: 'province',
  zip_code: 'zip_code',
  zip: 'zip_code',
  cap: 'zip_code',
  postal_code: 'zip_code',
  postcode: 'zip_code',
  region: 'region',
  regione: 'region',
  address: 'address',
  indirizzo: 'address',
  street: 'address',
  via: 'address',
  phone: 'phone',
  telefono: 'phone',
  tel: 'phone',
  cellulare: 'phone',
  mobile: 'phone',
  website: 'website',
  sito: 'website',
  sito_web: 'website',
  sito_internet: 'website',
  url: 'website',
  web: 'website',
  domain: 'website',
  category: 'category',
  categoria: 'category',
  settore: 'category',
  ateco: 'category',
  source: 'source',
  fonte: 'source',
  origine: 'source',
  vat_code: 'vat_code',
  vat: 'vat_code',
  vat_number: 'vat_code',
  piva: 'vat_code',
  partita_iva: 'vat_code',
  pg_url: 'pg_url',
  paginegialle: 'pg_url',
  paginegialle_url: 'pg_url',
  pgurl: 'pg_url',
  pg_link: 'pg_url',
  url_pg: 'pg_url',
  email: 'email',
  mail: 'email',
  e_mail: 'email',
  pec: 'email',
};

function normalizeHeaderKey(header: string): string {
  return header
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeFieldValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized === '' ? undefined : normalized;
}

export function pushIssue(diagnostics: CsvLoadDiagnostics, issue: string): void {
  if (diagnostics.sampleIssues.length < 10) {
    diagnostics.sampleIssues.push(issue);
  }
}

export function createCsvLoadDiagnostics(): CsvLoadDiagnostics {
  return {
    totalRows: 0,
    acceptedRows: 0,
    skippedRows: 0,
    skippedMissingCompanyName: 0,
    skippedInvalidRows: 0,
    aliasHits: 0,
    unknownHeaders: new Set<string>(),
    sampleIssues: [],
  };
}

export function normalizeCsvRowForScheduler(
  rawRow: Record<string, unknown>,
  diagnostics?: CsvLoadDiagnostics
): CSVCompany {
  const normalized: Partial<CSVCompany> = {};

  for (const [rawHeader, rawValue] of Object.entries(rawRow)) {
    const normalizedHeader = normalizeHeaderKey(rawHeader);
    if (!normalizedHeader) {
      continue;
    }

    const canonicalField = HEADER_ALIASES[normalizedHeader];
    if (!canonicalField) {
      diagnostics?.unknownHeaders.add(rawHeader.trim());
      continue;
    }

    if (normalizedHeader !== canonicalField) {
      diagnostics && (diagnostics.aliasHits += 1);
    }

    const value = normalizeFieldValue(rawValue);
    if (!value) {
      continue;
    }

    const existing = normalized[canonicalField];
    if (existing && String(existing).trim() !== '') {
      continue;
    }

    normalized[canonicalField] = canonicalField === 'province' ? value.toUpperCase() : value;
  }

  return normalized as CSVCompany;
}

export const CsvCompanySchema = z.object({
  company_id: z.string().optional(),
  company_name: z.string().trim().min(1),
  city: z.string().optional(),
  province: z.string().optional(),
  zip_code: z.string().optional(),
  region: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  category: z.string().optional(),
  source: z.string().optional(),
  vat_code: z.string().optional(),
  pg_url: z.string().optional(),
  email: z.string().optional(),
});
