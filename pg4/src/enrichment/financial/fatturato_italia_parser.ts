/**
 * R13 — fatturatoitalia.it page parser. PURE: takes HTML, returns data.
 * NO fetch, NO network, NO live scraper. The live lookup (deterministic
 * POST by P.IVA) is deferred to a later, rate-limited, opt-in phase
 * (see docs/r13_financial_enrichment_audit.md §9). This module only
 * understands the *shape* of a company page.
 *
 * Ported from pg3's `foundation/FatturatoItaliaProvider.ts` — specifically
 * the two extraction paths, kept as standalone functions:
 *   1. The embedded JS chart vars (`datiChartFatturato`, `datiChartUtile`,
 *      `labelChart`) — the cleanest, machine-readable 5-year history.
 *   2. The `.col-xs-5 / .col-xs-7` label/value grid — DOM fallback.
 *
 * Chart data wins when present (pg3 "Law 401: Source of Truth").
 */

import * as cheerio from 'cheerio';
import { extractVatCodesFromText } from './vat';
import { normalizeRevenueAmount, formatRevenueDisplay } from './revenue_parser';

export interface FIFinancialYear {
  year: number;
  fatturato?: number; // EUR
  utile?: number; // EUR
}

export interface FatturatoItaliaParseResult {
  company_name?: string;
  vat_code?: string;
  /** Display form, e.g. "€ 1.500.000". */
  revenue?: string;
  /** Numeric EUR. */
  revenue_amount?: number;
  revenue_year?: string;
  employees?: string;
  utile?: number;
  /** Full year history from the JS chart vars, newest-first as published. */
  history: FIFinancialYear[];
  source_url?: string;
  /** 0..1 — how confident we are this parse is real & complete. */
  confidence: number;
}

/**
 * Extract the EUR amount from a fatturatoitalia.it value string.
 * The site uses Italian formatting ("€ 40.503.424.402", "1,2 Mld").
 * Delegates to the shared `normalizeRevenueAmount`.
 */
function parseAmount(raw: string | undefined): number | undefined {
  return normalizeRevenueAmount(raw);
}

/**
 * Pull the 5-year series out of the embedded chart JS:
 *   var datiChartFatturato = [40503424402, 39245672100, ...];
 *   var datiChartUtile     = [1234567, ...];
 *   var labelChart         = ["2023", "2022", ...];
 */
function extractChartData(html: string): FIFinancialYear[] {
  const years: FIFinancialYear[] = [];

  const labelsMatch = html.match(/var\s+labelChart\s*=\s*\[([^\]]+)\]/);
  const fatturatoMatch = html.match(/var\s+datiChartFatturato\s*=\s*\[([^\]]+)\]/);
  const utileMatch = html.match(/var\s+datiChartUtile\s*=\s*\[([^\]]+)\]/);

  if (!labelsMatch || !fatturatoMatch) return years;

  const labels = labelsMatch[1].match(/\d{4}/g) || [];
  const fatturatoValues = fatturatoMatch[1].split(',').map((v) => Number.parseInt(v.trim(), 10));
  const utileValues = utileMatch
    ? utileMatch[1].split(',').map((v) => Number.parseInt(v.trim(), 10))
    : [];

  for (let i = 0; i < labels.length; i++) {
    const year = Number.parseInt(labels[i], 10);
    if (!Number.isFinite(year)) continue;
    const fatturato = fatturatoValues[i];
    const utile = utileValues[i];
    years.push({
      year,
      fatturato: Number.isFinite(fatturato) && fatturato > 0 ? fatturato : undefined,
      utile: Number.isFinite(utile) && utile !== 0 ? utile : undefined,
    });
  }

  return years;
}

/**
 * Parse the label/value grid:
 *   <div class="col-xs-5">Fatturato 2023</div>
 *   <div class="col-xs-7">€ 40.503.424.402</div>
 */
function parseGrid($: cheerio.CheerioAPI): {
  fatturato_current?: number;
  utile_current?: number;
  bilancio_year?: number;
  dipendenti?: string;
  ragione_sociale?: string;
  vat_code?: string;
} {
  const data: Record<string, string> = {};
  $('.col-xs-5, .col-sm-5').each((_, labelEl) => {
    const label = $(labelEl).text().trim().toLowerCase();
    const value = $(labelEl).next('.col-xs-7, .col-sm-7').text().trim();
    if (label && value) data[label] = value;
  });

  let fatturato_current: number | undefined;
  let utile_current: number | undefined;
  let bilancio_year: number | undefined;

  for (const [label, value] of Object.entries(data)) {
    const yearMatch = label.match(/\b(20\d{2})\b/);
    const year = yearMatch ? Number.parseInt(yearMatch[1], 10) : undefined;

    if (label.includes('fatturato')) {
      const amt = parseAmount(value);
      if (amt !== undefined && (bilancio_year === undefined || (year !== undefined && year > bilancio_year))) {
        fatturato_current = amt;
        if (year !== undefined) bilancio_year = year;
      }
    }
    if (label.includes('utile')) {
      const amt = parseAmount(value);
      if (amt !== undefined) utile_current = amt;
    }
  }

  const dipendentiRaw = data['n. dipendenti'] || data['dipendenti'] || data['numero dipendenti'];
  const dipendenti = dipendentiRaw ? dipendentiRaw.replace(/[^\d-]/g, '') || undefined : undefined;

  const ragione_sociale = data['ragione sociale'] || undefined;
  const vat_code = data['partita iva'] || data['p.iva'] || undefined;

  return { fatturato_current, utile_current, bilancio_year, dipendenti, ragione_sociale, vat_code };
}

/**
 * Parse a fatturatoitalia.it company-detail page into structured financials.
 * Pure: never fetches. Returns a result with `confidence: 0` and no fields
 * when the HTML is not a recognizable company page.
 *
 * Confidence heuristic:
 *   - chart series with a positive latest revenue  → 0.9
 *   - grid revenue only                            → 0.75
 *   - VAT/name found but no revenue                → 0.4
 *   - nothing                                      → 0.0
 */
export function parseFatturatoItaliaPage(
  html: string | null | undefined,
  sourceUrl?: string,
): FatturatoItaliaParseResult {
  const empty: FatturatoItaliaParseResult = { history: [], confidence: 0, source_url: sourceUrl };
  if (!html) return empty;

  const $ = cheerio.load(html);
  const bodyText = $('body').text();

  const history = extractChartData(html);
  const grid = parseGrid($);

  // Headline revenue: chart latest (positive) wins, else grid.
  let revenue_amount: number | undefined;
  let revenue_year: string | undefined;
  let utile: number | undefined = grid.utile_current;

  const latestChart = history.find((h) => h.fatturato !== undefined);
  if (latestChart) {
    revenue_amount = latestChart.fatturato;
    revenue_year = String(latestChart.year);
    if (latestChart.utile !== undefined) utile = latestChart.utile;
  } else if (grid.fatturato_current !== undefined) {
    revenue_amount = grid.fatturato_current;
    revenue_year = grid.bilancio_year !== undefined ? String(grid.bilancio_year) : undefined;
  }

  // Company name: grid value, else first <h1>.
  const company_name = grid.ragione_sociale || $('h1').first().text().trim() || undefined;

  // VAT: prefer the grid field, else scan the page body (checksum-validated).
  let vat_code = grid.vat_code ? grid.vat_code.replace(/\D/g, '') : undefined;
  if (!vat_code || vat_code.length !== 11) {
    vat_code = extractVatCodesFromText(bodyText)[0];
  }

  const employees = grid.dipendenti;

  let confidence = 0;
  if (revenue_amount !== undefined && latestChart) confidence = 0.9;
  else if (revenue_amount !== undefined) confidence = 0.75;
  else if (vat_code || company_name) confidence = 0.4;

  return {
    company_name,
    vat_code,
    revenue: formatRevenueDisplay(revenue_amount),
    revenue_amount,
    revenue_year,
    employees: employees || undefined,
    utile,
    history,
    source_url: sourceUrl,
    confidence,
  };
}
