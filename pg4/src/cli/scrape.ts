import fs from 'fs';
import path from 'path';
import { parseArgs, reqString, optString } from './_args';
import { logger } from '../runtime/logger';
import { CsvWriter } from '../io/csv_writer';
import { JsonlWriter } from '../io/jsonl_writer';
import { parsePagineGialleResults } from '../discovery/sources/pagine_gialle_parser';
import { parseGoogleMapsResults } from '../discovery/sources/google_maps_parser';
import { dedupeLeads, Deduplicator } from '../discovery/deduper';
import { rehydrateFromPriorRun } from '../runtime/resume';
import type { Lead } from '../types/lead';

/**
 * scrape — Phase 4
 *
 * Two modes coexist:
 *   1) FIXTURE (offline, deterministic):
 *        npm run scrape -- --fixture pg=path1.html,maps=path2.html \
 *           --category "agenzie immobiliari" --out output/raw.csv
 *
 *   2) LIVE (Playwright):
 *        npm run scrape -- --category "agenzie immobiliari" \
 *           --province BL --out output/raw.csv
 *      or constraining the comuni list:
 *        npm run scrape -- --category "..." --comuni "Belluno,Feltre,Sedico" \
 *           --out output/raw.csv
 *      Live mode skips Maps unless `--maps` is passed (PG-only by default
 *      because Maps requires a richer Cloudflare-bypass setup that we tune
 *      after the first benchmark). Mass live runs respect `--max-pages`,
 *      `--inter-delay-ms`, `--restart-every`.
 *
 * In live mode the orchestrator iterates the comuni list, runs PG live,
 * splits to comune-level on `overflow`, optionally runs Maps live per
 * comune, then dedupes globally before writing the raw CSV + JSONL.
 *
 * Live mode is intentionally lazy-loaded: the Playwright import only
 * happens when we know we're running live, so fixture mode + the
 * typecheck stay fast.
 */

interface FixtureSource { path: string; source: 'pg' | 'maps' }

async function main() {
  const args = parseArgs();
  const out = reqString(args, 'out', 'e.g. output/raw.csv');
  const category = optString(args, 'category');
  const fixtureFlag = optString(args, 'fixture');

  if (fixtureFlag) {
    await runFixtureMode({
      out,
      category,
      fixture: fixtureFlag,
      sourceFlag: optString(args, 'source'),
    });
    return;
  }

  if (!category) {
    throw new Error('Live mode requires --category. Pass --fixture <path> for offline mode.');
  }
  await runLiveMode({
    out,
    category,
    province: optString(args, 'province'),
    region: optString(args, 'region'),
    comuniCsv: optString(args, 'comuni'),
    maxPages: parseIntOrUndefined(optString(args, 'max-pages')),
    interDelayMs: parseIntOrUndefined(optString(args, 'inter-delay-ms')),
    runMaps: !!args.flags['maps'],
    headless: args.flags['headless'] !== 'false',
    checkpointPath: optString(args, 'checkpoint'),
    restartEvery: parseIntOrUndefined(optString(args, 'restart-every')),
    fresh: !!args.flags['fresh'],
    allowMissingJsonl: !!args.flags['allow-missing-jsonl'],
  });
}

// ============================================================
// FIXTURE MODE — kept identical to Phase 3.5 so smoke tests stay green
// ============================================================

interface FixtureModeArgs {
  out: string;
  category?: string;
  fixture: string;
  sourceFlag?: string;
}

async function runFixtureMode(a: FixtureModeArgs) {
  const sources = resolveFixtureSources(a.fixture, a.sourceFlag);
  if (sources.length === 0) throw new Error('No fixtures resolved from --fixture flag');
  const all: Lead[] = [];
  let totalCards = 0;
  let dropped = 0;
  let overflowDetected = false;
  let capLikelyDetected = false;
  for (const fx of sources) {
    if (!fs.existsSync(fx.path)) {
      logger.warn({ path: fx.path }, '[scrape] fixture not found, skipping');
      continue;
    }
    const html = fs.readFileSync(fx.path, 'utf8');
    if (fx.source === 'pg') {
      const r = parsePagineGialleResults(html, { category: a.category });
      totalCards += r.total_cards;
      dropped += r.dropped;
      overflowDetected = overflowDetected || r.overflow;
      logger.info({ fixture: fx.path, cards: r.total_cards, parsed: r.results.length, dropped: r.dropped, overflow: r.overflow }, '[scrape] PG fixture parsed');
      all.push(...r.results);
    } else {
      const r = parseGoogleMapsResults(html, { category: a.category });
      totalCards += r.total_cards;
      dropped += r.dropped;
      capLikelyDetected = capLikelyDetected || r.cap_likely;
      logger.info({ fixture: fx.path, cards: r.total_cards, parsed: r.results.length, dropped: r.dropped, cap_likely: r.cap_likely }, '[scrape] Maps fixture parsed');
      all.push(...r.results);
    }
  }
  await emitCsvJsonl(a.out, dedupeLeads(all), {
    fixtures: sources.length,
    total_cards: totalCards,
    dropped_at_parse: dropped,
    raw_pre_dedupe: all.length,
    overflow: overflowDetected,
    cap_likely: capLikelyDetected,
    mode: 'fixture',
  });
}

function resolveFixtureSources(fixtureFlag: string, sourceFlag?: string): FixtureSource[] {
  if (fixtureFlag.includes('=')) {
    return fixtureFlag.split(',').map((piece) => {
      const [src, p] = piece.split('=', 2);
      if ((src !== 'pg' && src !== 'maps') || !p) throw new Error(`Invalid fixture spec "${piece}"`);
      return { source: src, path: p } satisfies FixtureSource;
    });
  }
  if (sourceFlag !== 'pg' && sourceFlag !== 'maps') {
    throw new Error('When --fixture is a single path, --source must be "pg" or "maps".');
  }
  return [{ source: sourceFlag, path: fixtureFlag }];
}

// ============================================================
// LIVE MODE — Playwright orchestrator (lazy-loaded)
// ============================================================

interface LiveModeArgs {
  out: string;
  category: string;
  province?: string;
  region?: string;
  comuniCsv?: string;
  maxPages?: number;
  interDelayMs?: number;
  runMaps?: boolean;
  headless?: boolean;
  checkpointPath?: string;
  restartEvery?: number;
  /**
   * When true, delete the previous CSV/JSONL/checkpoint at `out` and
   * start a fresh run. Without it, an existing JSONL alongside the
   * checkpoint is reloaded so resume produces a complete CSV.
   */
  fresh?: boolean;
  /**
   * Phase 4.2.1: an existing checkpoint that says pages are `done`
   * combined with a missing JSONL is a HARD ERROR by default — the
   * resulting CSV would silently miss every lead from those pages.
   * Pass `--allow-missing-jsonl` to acknowledge the data loss and
   * proceed anyway. Pass `--fresh` to wipe the checkpoint instead.
   */
  allowMissingJsonl?: boolean;
}

async function runLiveMode(a: LiveModeArgs) {
  // Lazy-load the live navigator + browser modules so fixture mode
  // never has to spin up Playwright.
  const { BrowserFactory } = await import('../browser/factory');
  const { scrapePgLocation } = await import('../discovery/sources/pg_live');
  const { scrapeMapsLocation } = await import('../discovery/sources/maps_live');
  const { Checkpoint } = await import('../runtime/checkpoint');
  const { logConsentSummary } = await import('../browser/consent_handler');
  const { getComuniForProvince, parseComuniList } = await import('../discovery/sources/italy_geo');

  const comuni = resolveComuniList(a, getComuniForProvince, parseComuniList);
  if (comuni.length === 0) {
    throw new Error('Live mode needs --province (curated list) or --comuni "C1,C2,...".');
  }

  const checkpointPath = a.checkpointPath ?? path.join(path.dirname(a.out), `.scrape-checkpoint-${slug(a.category)}.json`);
  const jsonlOut = a.out.replace(/\.csv$/i, '') + '.jsonl';

  // --fresh: wipe the prior run's artifacts so the next run is clean.
  if (a.fresh) {
    for (const f of [a.out, jsonlOut, checkpointPath]) {
      try { fs.unlinkSync(f); } catch { /* ignore missing */ }
    }
    logger.info({ out: a.out, jsonl: jsonlOut, checkpoint: checkpointPath }, '[scrape] --fresh: wiped prior run artifacts');
  }

  const checkpoint = new Checkpoint(checkpointPath);
  const factory = new BrowserFactory({
    id: `scrape-${slug(a.category)}`,
    headless: a.headless,
    restartEvery: a.restartEvery,
  });

  const dedup = new Deduplicator();
  const allLeads: Lead[] = [];

  // RESUME: if a JSONL from a prior run is present alongside a non-empty
  // checkpoint, re-hydrate the deduper + lead set BEFORE iterating any
  // comune. Otherwise checkpointed pages skip without contributing leads,
  // and the resulting CSV would silently miss the work that was already
  // done. Phase 4.2.1: this is now a HARD ERROR instead of a warning when
  // the JSONL is missing — operator must pass `--fresh` or
  // `--allow-missing-jsonl`.
  const resumed = await rehydrateFromPriorRun({
    jsonlPath: jsonlOut,
    checkpoint,
    dedup,
    sink: allLeads,
    allowMissingJsonl: !!a.allowMissingJsonl,
  });

  let totalCards = 0;
  let dropped = 0;
  let comuniWithOverflow = 0;
  let comuniWithCapLikely = 0;

  try {
    // Stage 1: PG run for each comune in the curated list.
    for (const comune of comuni) {
      const r = await scrapePgLocation(factory, {
        category: a.category,
        location: comune,
        maxPages: a.maxPages,
        checkpoint,
        interPageDelayMs: a.interDelayMs,
      });
      totalCards += r.total_cards;
      dropped += r.dropped;
      if (r.overflow) comuniWithOverflow += 1;
      ingestBatch(allLeads, dedup, r.results);
      // Save state after each comune so an interrupted run resumes cleanly.
      await factory.saveSessionState();
    }
    // Stage 2 (optional): Maps per comune.
    if (a.runMaps) {
      for (const comune of comuni) {
        const r = await scrapeMapsLocation(factory, {
          category: a.category,
          location: comune,
          checkpoint,
        });
        totalCards += r.total_cards;
        dropped += r.dropped;
        if (r.cap_likely) comuniWithCapLikely += 1;
        ingestBatch(allLeads, dedup, r.results);
        await factory.saveSessionState();
      }
    }
  } finally {
    logConsentSummary();
    await factory.close();
  }

  await emitCsvJsonl(a.out, allLeads, {
    mode: 'live',
    province: a.province,
    region: a.region,
    comuni_count: comuni.length,
    pg_overflow_count: comuniWithOverflow,
    maps_cap_likely_count: comuniWithCapLikely,
    total_cards: totalCards,
    dropped_at_parse: dropped,
    raw_pre_dedupe: allLeads.length,
    checkpoint_done: checkpoint.countDone(),
    resumed_from_prior_jsonl: resumed,
    factory: factory.describe(),
  });
}


function resolveComuniList(
  a: LiveModeArgs,
  getComuniForProvince: (code: string) => string[],
  parseComuniList: (csv: string) => string[]
): string[] {
  if (a.comuniCsv && a.comuniCsv.trim()) return parseComuniList(a.comuniCsv);
  if (a.province && a.province.trim()) {
    const c = getComuniForProvince(a.province);
    if (c.length > 0) return c;
    // Fallback: scrape only the province capital ASCII-style (province code).
    return [a.province.trim().toUpperCase()];
  }
  return [];
}

function ingestBatch(allLeads: Lead[], dedup: Deduplicator, batch: Lead[]): void {
  for (const lead of batch) {
    const existing = dedup.find(lead);
    if (existing) {
      dedup.merge(existing, lead);
    } else {
      dedup.add(lead);
      allLeads.push(lead);
    }
  }
}

// ============================================================
// SHARED — output emission
// ============================================================

async function emitCsvJsonl(outCsv: string, leads: Lead[], summary: Record<string, unknown>): Promise<void> {
  const jsonlOut = outCsv.replace(/\.csv$/i, '') + '.jsonl';
  const csv = new CsvWriter(outCsv, 'raw');
  const jsonl = new JsonlWriter(jsonlOut);
  for (const lead of leads) {
    await csv.write(lead);
    await jsonl.write(lead);
  }
  await csv.close();
  await jsonl.close();
  logger.info(
    {
      ...summary,
      raw_post_dedupe: leads.length,
      collapsed_by_dedupe: typeof summary.raw_pre_dedupe === 'number' ? (summary.raw_pre_dedupe as number) - leads.length : 0,
      output_csv: path.resolve(outCsv),
      output_jsonl: path.resolve(jsonlOut),
    },
    '[scrape] complete'
  );
}

// ============================================================

function parseIntOrUndefined(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

function slug(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

main().catch((err) => {
  logger.error({ err: err.message, stack: err.stack }, '[scrape] failed');
  process.exit(1);
});
