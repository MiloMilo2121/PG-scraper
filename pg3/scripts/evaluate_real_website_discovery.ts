import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { MasterPipeline } from '../src/foundation/MasterPipeline';
import { InputNormalizer } from '../src/foundation/InputNormalizer';
import { ShadowRegistry } from '../src/foundation/ShadowRegistry';
import { PreVerifyGate } from '../src/foundation/PreVerifyGate';
import { SerpDeduplicator } from '../src/foundation/SerpDeduplicator';
import { LLMOracleGuard } from '../src/foundation/LLMOracleGuard';
import { StopTheBleedingController } from '../src/foundation/StopTheBleedingController';
import { EnrichmentBuffer } from '../src/foundation/EnrichmentBuffer';
import { QuerySanitizer } from '../src/foundation/QuerySanitizer';
import { BackpressureValve } from '../src/shared-runtime/control/BackpressureValve';
import { BrowserPool } from '../src/shared-runtime/browser/BrowserPool';
import { MemoryFirstCache } from '../src/shared-runtime/cache/MemoryFirstCache';
import { CostLedger } from '../src/shared-runtime/budget/CostLedger';
import { CostRouter } from '../src/shared-runtime/routing/CostRouter';
import { HTTP_PROVIDER_ORDER, SERP_PROVIDER_ORDER } from '../src/shared-runtime/routing/provider_catalog';
import { buildProviderMap } from '../src/enricher/runtime/provider_catalog';
import { config } from '../src/enricher/config';
import { ContentFilter } from '../src/enricher/core/discovery/content_filter';
import { PagineGialleHarvester } from '../src/enricher/core/directories/paginegialle';

type CsvRow = Record<string, string>;

interface EvaluationRow {
  company_name: string;
  city: string;
  phone: string;
  expected_website: string;
  found_website: string;
  expected_domain: string;
  found_domain: string;
  exact_match: boolean;
  domain_match: boolean;
  status: string;
  reason_code: string;
  discovery_layer: string;
  duration_ms: number;
}

interface Summary {
  dataset_input_csv: string;
  dataset_expected_csv: string;
  total_candidates: number;
  evaluated: number;
  found_complete: number;
  exact_match_count: number;
  domain_match_count: number;
  miss_count: number;
  exact_match_rate: number;
  domain_match_rate: number;
  layers: Record<string, number>;
  reason_codes: Record<string, number>;
  output_csv: string;
  output_json: string;
}

const GENERIC_BENCHMARK_TOKENS = new Set([
  'impianti',
  'industriali',
  'industriali',
  'servizi',
  'service',
  'solutions',
  'tecnologie',
  'tecnologia',
  'sistemi',
  'costruzioni',
  'manutenzione',
  'manutenzioni',
  'elettrici',
  'elettrico',
  'azienda',
  'azienda',
  'societa',
  'gruppo',
]);

interface DiscoveryRuntime {
  pipeline: MasterPipeline;
  cleanup(): Promise<void>;
}

interface CliArgs {
  inputCsv: string;
  expectedCsv: string;
  limit: number;
  outDir: string;
}

function parseArgs(argv: string[]): CliArgs {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const flags = new Map<string, string>();

  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      continue;
    }

    const trimmed = arg.slice(2);
    const [key, value] = trimmed.split('=', 2);
    flags.set(key, value ?? 'true');
  }

  const inputCsv = flags.get('input') || positional[0];
  const expectedCsv = flags.get('expected') || positional[1];
  const limit = Number(flags.get('limit') || '30');
  const outDir = path.resolve(
    flags.get('out-dir') || path.join('output', 'website_eval', `real_eval_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`)
  );

  if (!inputCsv || !expectedCsv) {
    throw new Error(
      'Usage: npx ts-node scripts/evaluate_real_website_discovery.ts --input=<input.csv> --expected=<expected.csv> [--limit=30] [--out-dir=output/website_eval/...]'
    );
  }

  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`Invalid --limit value: ${limit}`);
  }

  return {
    inputCsv: path.resolve(inputCsv),
    expectedCsv: path.resolve(expectedCsv),
    limit,
    outDir,
  };
}

function readCsv(filePath: string): CsvRow[] {
  return parse(fs.readFileSync(filePath, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    delimiter: ',',
  }) as CsvRow[];
}

function getExpectedWebsite(row: CsvRow): string {
  return (row.website_validated || row.website_url || row.website || '').trim();
}

function normalizePhone(value?: string): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function joinKey(row: CsvRow): string {
  return [
    (row.company_name || '').trim(),
    (row.city || '').trim(),
    normalizePhone(row.phone),
  ].join('||');
}

function normalizeUrl(url?: string): string {
  const raw = (url || '').trim();
  if (!raw) {
    return '';
  }

  try {
    const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
    const parsed = new URL(withProtocol);
    parsed.hash = '';
    parsed.search = '';
    parsed.username = '';
    parsed.password = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
  } catch {
    return raw.toLowerCase();
  }
}

function registrableDomain(url?: string): string {
  const normalized = normalizeUrl(url);
  if (!normalized) {
    return '';
  }

  try {
    const hostname = new URL(normalized).hostname.replace(/^www\./i, '').toLowerCase();
    const labels = hostname.split('.').filter(Boolean);
    if (labels.length <= 2) {
      return hostname;
    }

    const commonCountrySecondLevelDomains = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org']);
    const lastLabel = labels[labels.length - 1];
    const penultimateLabel = labels[labels.length - 2];
    if (lastLabel.length === 2 && commonCountrySecondLevelDomains.has(penultimateLabel) && labels.length >= 3) {
      return labels.slice(-3).join('.');
    }

    return labels.slice(-2).join('.');
  } catch {
    return normalized;
  }
}

function percentage(value: number, total: number): number {
  return total > 0 ? Number(((value / total) * 100).toFixed(1)) : 0;
}

function benchmarkNameTokens(companyName?: string): string[] {
  return (companyName || '')
    .toLowerCase()
    .replace(/s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|societa'?|unipersonale|in liquidazione/gi, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4);
}

function benchmarkScore(input: CsvRow, expected: CsvRow): number {
  const companyName = input.company_name || expected.company_name || '';
  const tokens = benchmarkNameTokens(companyName);
  const nonGenericTokens = tokens.filter((token) => !GENERIC_BENCHMARK_TOKENS.has(token));

  let score = 0;

  if (normalizePhone(input.phone).length >= 6) {
    score += 2;
  }

  if ((input.address || expected.address || '').trim()) {
    score += 2;
  }

  if ((input.pg_url || expected.pg_url || '').trim()) {
    score += 3;
  }

  if ((input.city || expected.city || '').trim().length > 2) {
    score += 1;
  }

  if (tokens.length >= 2) {
    score += 1.5;
  }

  if (nonGenericTokens.length >= 2) {
    score += 3;
  } else if (nonGenericTokens.length === 1) {
    score += 1;
  }

  if (/\b(?:[A-Z]\.){2,}/.test(companyName)) {
    score -= 3;
  }

  if (tokens.length <= 1) {
    score -= 2;
  }

  return score;
}

function createDiscoveryOnlyRuntime(): DiscoveryRuntime {
  const ledger = new CostLedger({ filePath: config.runtime.costLedgerPath });
  const cache = new MemoryFirstCache({ l1MaxMemoryMB: 50 });
  const valve = new BackpressureValve({
    ledger,
    initialConcurrency: 1,
    maxConcurrency: 2,
  });
  const pool = new BrowserPool({
    ledger,
    maxInstances: 1,
    maxRequestsPerInstance: 20,
    navigationTimeout: config.runtime.browserPoolNavTimeoutMs,
    sessionStateDir: config.runtime.browserSessionDir,
    chromePath: config.browser.chromePath,
    localNavigationCostEur: config.costing.localBrowserNavCostEur,
  });
  const registry = new ShadowRegistry('omega_shadow.sqlite');
  const router = new CostRouter(cache, ledger, buildProviderMap(), {
    SERP: SERP_PROVIDER_ORDER,
    PROXY_FETCH: HTTP_PROVIDER_ORDER,
  });
  const bleedingCtrl = new StopTheBleedingController(ledger, valve, pool);
  const gate = new PreVerifyGate(cache, ledger);
  const buffer = new EnrichmentBuffer(cache);
  const dedup = new SerpDeduplicator(router, new QuerySanitizer(), buffer);
  const oracleGuard = new LLMOracleGuard(cache, valve);

  const noopBilancioHunter = { hunt: async () => null };
  const noopLinkedinSniper = { snipe: async () => null };
  const noopPostProcessor = { estimateEmployees: async () => null };
  const noopPecHunter = { hunt: async () => null };

  const pipeline = new MasterPipeline({
    normalizer: new InputNormalizer(),
    registry,
    gate,
    dedup,
    oracleGuard,
    bleedingCtrl,
    valve,
    bilancioHunter: noopBilancioHunter as any,
    linkedinSniper: noopLinkedinSniper as any,
    browserPool: pool,
    costRouter: router,
    postProcessor: noopPostProcessor as any,
    pecHunter: noopPecHunter as any,
  });

  // Website-discovery benchmark only: bypass downstream enrichment stages entirely.
  (pipeline as any).postDiscoveryEnrichment = {
    run: async () => ({
      financial: null,
      decisionMaker: null,
      employees: null,
      isEstimatedEmployees: false,
      vat: null,
      pec: null,
      email: null,
      stageOutcomes: {
        financial: {
          stage: 'financial',
          status: 'skipped',
          duration_ms: 0,
          detail: 'website-only evaluation',
        },
        decision_maker: {
          stage: 'decision_maker',
          status: 'skipped',
          duration_ms: 0,
          detail: 'website-only evaluation',
        },
        employee_estimation: {
          stage: 'employee_estimation',
          status: 'skipped',
          duration_ms: 0,
          detail: 'website-only evaluation',
        },
        contacts: {
          stage: 'contacts',
          status: 'skipped',
          duration_ms: 0,
          detail: 'website-only evaluation',
        },
      },
    }),
  };

  return {
    pipeline,
    cleanup: async () => {
      valve.cleanup();
      ledger.cleanup();
      router.cleanup();
      await pool.destroyAll();
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const inputRows = readCsv(args.inputCsv);
  const expectedRows = readCsv(args.expectedCsv);
  const expectedWithSite = expectedRows.filter((row) => {
    const expectedWebsite = getExpectedWebsite(row);
    return Boolean(expectedWebsite) && !ContentFilter.isDirectoryOrSocial(expectedWebsite);
  });
  const inputByKey = new Map(inputRows.map((row) => [joinKey(row), row]));

  const evaluationTargets = expectedWithSite
    .map((row) => {
      const input = inputByKey.get(joinKey(row));
      return input
        ? { input, expected: row, benchmark_score: benchmarkScore(input, row) }
        : null;
    })
    .filter((row): row is { input: CsvRow; expected: CsvRow; benchmark_score: number } => Boolean(row))
    .sort((left, right) => right.benchmark_score - left.benchmark_score);

  const selectionPool = evaluationTargets.slice(0, Math.max(args.limit * 4, 80));
  const pgQualifiedTargets: typeof evaluationTargets = [];

  for (const target of selectionPool) {
    if (!(target.input.pg_url || target.expected.pg_url || target.input.phone)) {
      continue;
    }

    try {
      const harvest = await PagineGialleHarvester.harvestByPhone({
        ...target.input,
        pg_url: target.input.pg_url || target.expected.pg_url,
      } as any);

      if (harvest?.officialWebsite && !ContentFilter.isDirectoryOrSocial(harvest.officialWebsite)) {
        pgQualifiedTargets.push(target);
      }
    } catch {
      // Ignore selection-time PG failures and continue scanning the pool.
    }

    if (pgQualifiedTargets.length >= args.limit) {
      break;
    }
  }

  const finalTargets = (pgQualifiedTargets.length >= args.limit ? pgQualifiedTargets : evaluationTargets)
    .slice(0, args.limit);

  if (finalTargets.length === 0) {
    throw new Error('No rows with expected websites could be matched between input and expected CSVs.');
  }

  fs.mkdirSync(args.outDir, { recursive: true });
  const outputCsv = path.join(args.outDir, 'real_website_eval_results.csv');
  const outputJson = path.join(args.outDir, 'real_website_eval_summary.json');

  console.log(`[RealEval] Selected ${finalTargets.length} real companies from ${args.expectedCsv}`);
  console.log(`[RealEval] Selection strategy: ${pgQualifiedTargets.length >= args.limit ? 'benchmarkable_pg' : 'benchmarkable'}`);
  console.log(`[RealEval] Output directory: ${args.outDir}`);

  const runtime = createDiscoveryOnlyRuntime();
  const details: EvaluationRow[] = [];

  try {
    for (const [index, target] of finalTargets.entries()) {
      const expectedWebsite = getExpectedWebsite(target.expected);
      console.log(`[RealEval] ${index + 1}/${finalTargets.length} ${target.input.company_name} (${target.input.city})`);

      const liveInput = { ...target.input };
      delete liveInput.website;
      const result = await runtime.pipeline.processCompany(liveInput, index);
      const foundWebsite = result.website?.url || '';
      const expectedNormalized = normalizeUrl(expectedWebsite);
      const foundNormalized = normalizeUrl(foundWebsite);
      const expectedDomain = registrableDomain(expectedWebsite);
      const foundDomain = registrableDomain(foundWebsite);

      details.push({
        company_name: target.input.company_name || '',
        city: target.input.city || '',
        phone: normalizePhone(target.input.phone),
        expected_website: expectedNormalized,
        found_website: foundNormalized,
        expected_domain: expectedDomain,
        found_domain: foundDomain,
        exact_match: Boolean(expectedNormalized && foundNormalized && expectedNormalized === foundNormalized),
        domain_match: Boolean(expectedDomain && foundDomain && expectedDomain === foundDomain),
        status: result.status || '',
        reason_code: result.reason_code || '',
        discovery_layer: result.website?.discovery_layer || '',
        duration_ms: Number(result.meta?.duration_ms || 0),
      });
    }
  } finally {
    await runtime.cleanup();
  }

  const foundComplete = details.filter((row) => row.status === 'FOUND_COMPLETE').length;
  const exactMatchCount = details.filter((row) => row.exact_match).length;
  const domainMatchCount = details.filter((row) => row.domain_match).length;
  const missCount = details.length - domainMatchCount;

  const layers = details.reduce<Record<string, number>>((acc, row) => {
    const key = row.discovery_layer || 'NONE';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const reasonCodes = details.reduce<Record<string, number>>((acc, row) => {
    const key = row.reason_code || 'NONE';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const summary: Summary = {
    dataset_input_csv: args.inputCsv,
    dataset_expected_csv: args.expectedCsv,
    total_candidates: expectedWithSite.length,
    evaluated: details.length,
    found_complete: foundComplete,
    exact_match_count: exactMatchCount,
    domain_match_count: domainMatchCount,
    miss_count: missCount,
    exact_match_rate: percentage(exactMatchCount, details.length),
    domain_match_rate: percentage(domainMatchCount, details.length),
    layers,
    reason_codes: reasonCodes,
    output_csv: outputCsv,
    output_json: outputJson,
  };

  fs.writeFileSync(outputCsv, stringify(details, { header: true }), 'utf8');
  fs.writeFileSync(outputJson, JSON.stringify(summary, null, 2), 'utf8');

  console.log('[RealEval] Summary');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error('[RealEval] Fatal error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
