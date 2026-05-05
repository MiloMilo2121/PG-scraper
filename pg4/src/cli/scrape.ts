import fs from 'fs';
import path from 'path';
import { parseArgs, reqString, optString } from './_args';
import { logger } from '../runtime/logger';
import { CsvWriter } from '../io/csv_writer';
import { JsonlWriter } from '../io/jsonl_writer';
import { parsePagineGialleResults } from '../discovery/sources/pagine_gialle_parser';
import { parseGoogleMapsResults } from '../discovery/sources/google_maps_parser';
import { dedupeLeads } from '../discovery/deduper';
import type { Lead } from '../types/lead';

/**
 * Scrape command.
 *
 * Phase 3.5 — DRY-RUN mode is wired:
 *   npm run scrape -- \
 *     --fixture tests/fixtures/scraper/pg_belluno_normal.html \
 *     --source pg \
 *     --category "agenzie immobiliari" \
 *     --out output/raw.csv
 *
 * `--source pg|maps` selects the parser; `--fixture` is a path to a saved
 * HTML page (or a comma-separated list to merge multiple sources).
 *
 * Phase 4 — LIVE mode (PG navigation + Maps grid scroll) is not yet wired;
 * passing `--category` without `--fixture` falls through to a stub.
 */

interface FixtureSource {
  path: string;
  source: 'pg' | 'maps';
}

async function main() {
  const args = parseArgs();
  const out = reqString(args, 'out', 'e.g. output/raw.csv');
  const category = optString(args, 'category');
  const fixtureFlag = optString(args, 'fixture');
  const sourceFlag = optString(args, 'source');

  if (!fixtureFlag) {
    logger.info(
      { category, out },
      '[scrape] live PG/Maps scraping not yet wired (Phase 4). Use --fixture <html_path> for the dry-run mode.'
    );
    return;
  }

  // Parse fixture list. Format: "pg=path1.html,maps=path2.html" OR a single path with --source.
  const sources = resolveFixtureSources(fixtureFlag, sourceFlag);
  if (sources.length === 0) {
    throw new Error('No fixtures resolved from --fixture flag');
  }

  const allParsed: Array<{ source: 'pg' | 'maps'; lead: Lead }> = [];
  let totalCards = 0;
  let dropped = 0;
  let overflowDetected = false;

  for (const fx of sources) {
    if (!fs.existsSync(fx.path)) {
      logger.warn({ path: fx.path }, '[scrape] fixture not found, skipping');
      continue;
    }
    const html = fs.readFileSync(fx.path, 'utf8');
    if (fx.source === 'pg') {
      const r = parsePagineGialleResults(html, { category });
      totalCards += r.total_cards;
      dropped += r.dropped;
      overflowDetected = overflowDetected || r.overflow;
      logger.info(
        { fixture: fx.path, cards: r.total_cards, parsed: r.results.length, dropped: r.dropped, overflow: r.overflow },
        '[scrape] PG fixture parsed'
      );
      for (const lead of r.results) allParsed.push({ source: 'pg', lead });
    } else {
      const r = parseGoogleMapsResults(html, { category });
      totalCards += r.total_cards;
      dropped += r.dropped;
      logger.info(
        { fixture: fx.path, cards: r.total_cards, parsed: r.results.length, dropped: r.dropped },
        '[scrape] Maps fixture parsed'
      );
      for (const lead of r.results) allParsed.push({ source: 'maps', lead });
    }
  }

  // Dedupe — PG comes first so PG fields win on conflict.
  const ordered = [...allParsed.filter((p) => p.source === 'pg'), ...allParsed.filter((p) => p.source === 'maps')];
  const beforeCount = ordered.length;
  const merged = dedupeLeads(ordered.map((p) => p.lead));
  const afterCount = merged.length;
  const collapsedCount = beforeCount - afterCount;

  // Write CSV (raw schema) + JSONL (full debug)
  const jsonlOut = out.replace(/\.csv$/i, '') + '.jsonl';
  const csv = new CsvWriter(out, 'raw');
  const jsonl = new JsonlWriter(jsonlOut);
  for (const lead of merged) {
    await csv.write(lead);
    await jsonl.write(lead);
  }
  await csv.close();
  await jsonl.close();

  logger.info(
    {
      fixtures: sources.length,
      total_cards: totalCards,
      dropped_at_parse: dropped,
      raw_pre_dedupe: beforeCount,
      raw_post_dedupe: afterCount,
      collapsed_by_dedupe: collapsedCount,
      overflow: overflowDetected,
      output_csv: path.resolve(out),
      output_jsonl: path.resolve(jsonlOut),
    },
    '[scrape] dry-run complete'
  );
}

function resolveFixtureSources(fixtureFlag: string, sourceFlag?: string): FixtureSource[] {
  // 1) "pg=path1.html,maps=path2.html" inline form
  if (fixtureFlag.includes('=')) {
    return fixtureFlag.split(',').map((piece) => {
      const [src, p] = piece.split('=', 2);
      if ((src !== 'pg' && src !== 'maps') || !p) {
        throw new Error(`Invalid fixture spec "${piece}". Expected pg=<path> or maps=<path>.`);
      }
      return { source: src, path: p } satisfies FixtureSource;
    });
  }
  // 2) single path with --source
  if (sourceFlag !== 'pg' && sourceFlag !== 'maps') {
    throw new Error('When --fixture is a single path, --source must be "pg" or "maps".');
  }
  return [{ source: sourceFlag, path: fixtureFlag }];
}

main().catch((err) => {
  logger.error({ err: err.message, stack: err.stack }, '[scrape] failed');
  process.exit(1);
});
