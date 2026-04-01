import * as fs from 'fs';
import * as path from 'path';
import * as dns from 'dns';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

import { HyperGuesserVXFetcher } from '../src/enricher/core/discovery/hyperguesser_vx/fetcher';
import { selectBestSemanticCandidate } from '../src/enricher/core/discovery/hyperguesser_vx/semantic_matcher';
import { CompanyInput } from '../src/enricher/types';
import { DomainGuesser } from '../src/enricher/utils/domain_guesser';
import {
  EmailInferenceResult,
  getHostname,
  getRegistrableDomain,
  inferEmailFromDomain,
} from '../src/enricher/utils/email_inference';

type CampaignRow = Record<string, string>;

interface InferredCampaignRow extends CampaignRow {
  inferred_domain: string;
  inferred_website_url: string;
  inferred_email: string;
  inferred_email_candidates: string;
  inference_mode: string;
  inference_confidence: string;
  best_email: string;
  best_email_source: string;
}

interface Summary {
  total_rows: number;
  rows_missing_contact_input: number;
  rows_inferred_from_website_mx: number;
  rows_inferred_from_company_guess_semantic: number;
  rows_with_best_email_after_inference: number;
}

function parseArg(flag: string): string | undefined {
  const match = process.argv.slice(2).find((arg) => arg.startsWith(`${flag}=`));
  return match?.slice(flag.length + 1);
}

function pickAnchorDomain(row: CampaignRow): string | undefined {
  for (const key of ['website_used_for_contacts', 'pg_official_website', 'input_website_clean']) {
    const host = getHostname(row[key]);
    if (!host) {
      continue;
    }
    const domain = getRegistrableDomain(host);
    if (domain) {
      return domain;
    }
  }

  return undefined;
}

function toCompanyInput(row: CampaignRow): CompanyInput {
  return {
    company_name: row.company_name || row.name || '',
    address: row.address || undefined,
    city: row.city || undefined,
    province: row.province || undefined,
    phone: row.phone || undefined,
    category: row.category || undefined,
    vat_code: row.vat_code || undefined,
  };
}

async function confirmGuessedWebsite(
  row: CampaignRow,
  domainGuesser: DomainGuesser,
  resolveMxCached: (domain: string) => Promise<unknown[]>,
): Promise<{ domain: string; url: string; confidence: number } | null> {
  const company = toCompanyInput(row);
  const guesses = domainGuesser.guessFromCompanyName(company.company_name);
  if (!guesses.length) {
    return null;
  }

  const uniqueGuesses = Array.from(new Set(guesses));
  const mxChecks = await Promise.all(uniqueGuesses.map(async (domain) => ({
    domain,
    alive: (await resolveMxCached(domain)).length > 0,
  })));
  const aliveGuesses = mxChecks.filter((entry) => entry.alive).map((entry) => entry.domain);

  if (!aliveGuesses.length) {
    return null;
  }

  const fetchedCandidates = await HyperGuesserVXFetcher.fetchBatch(aliveGuesses, Math.min(5, aliveGuesses.length));
  const match = selectBestSemanticCandidate(company, fetchedCandidates, 0.72);
  if (!match) {
    return null;
  }

  return {
    domain: match.domain,
    url: match.selected_url,
    confidence: match.confidence,
  };
}

async function main(): Promise<void> {
  const inputCsv = process.argv[2];
  if (!inputCsv || !fs.existsSync(inputCsv)) {
    throw new Error('Usage: npx ts-node scripts/infer_missing_contact_emails.ts <contacts_enriched.csv> [--output=path] [--allow-company-guess=true]');
  }

  const outputCsv = parseArg('--output') || path.join(
    path.dirname(inputCsv),
    `${path.basename(inputCsv, path.extname(inputCsv))}_with_inference.csv`,
  );
  const outputSummary = outputCsv.replace(/\.csv$/i, '_summary.json');
  const allowCompanyGuess = ['1', 'true', 'yes'].includes((parseArg('--allow-company-guess') || '').toLowerCase());

  const rawCsv = fs.readFileSync(inputCsv, 'utf8');
  const rows = parse(rawCsv, { columns: true, skip_empty_lines: true }) as CampaignRow[];
  const mxCache = new Map<string, boolean>();
  const domainGuesser = new DomainGuesser();

  const resolveMxCached = async (domain: string): Promise<unknown[]> => {
    if (mxCache.has(domain)) {
      return mxCache.get(domain) ? [{ cached: true }] : [];
    }

    try {
      const records = await dns.promises.resolveMx(domain);
      const ok = !!records?.length;
      mxCache.set(domain, ok);
      return ok ? records : [];
    } catch {
      mxCache.set(domain, false);
      return [];
    }
  };

  const enriched: InferredCampaignRow[] = [];
  let rowsMissingContactInput = 0;
  let rowsInferredFromWebsiteMx = 0;
  let rowsInferredFromCompanyGuessSemantic = 0;

  for (const row of rows) {
    const confirmedEmail = (row.final_email || '').trim().toLowerCase();
    const confirmedPec = (row.final_pec || '').trim().toLowerCase();
    let inference: EmailInferenceResult | null = null;

    if (!confirmedEmail && !confirmedPec) {
      rowsMissingContactInput += 1;

      const anchorDomain = pickAnchorDomain(row);
      if (anchorDomain) {
        inference = await inferEmailFromDomain(
          row.company_name || row.name || '',
          anchorDomain,
          'website_mx',
          resolveMxCached,
        );
      }

      if (!inference && !anchorDomain && allowCompanyGuess) {
        const guessedWebsite = await confirmGuessedWebsite(row, domainGuesser, resolveMxCached);
        if (guessedWebsite) {
          inference = await inferEmailFromDomain(
            row.company_name || row.name || '',
            guessedWebsite.domain,
            'company_guess_semantic',
            resolveMxCached,
          );
          if (inference) {
            inference.websiteUrl = guessedWebsite.url;
            inference.confidence = Math.max(inference.confidence, guessedWebsite.confidence * 0.75);
          }
        }
      }
    }

    if (inference?.mode === 'website_mx') {
      rowsInferredFromWebsiteMx += 1;
    } else if (inference?.mode === 'company_guess_semantic') {
      rowsInferredFromCompanyGuessSemantic += 1;
    }

    const bestEmail = confirmedEmail || inference?.inferredEmail || '';
    const bestEmailSource = confirmedEmail
      ? (row.contact_source || 'confirmed')
      : inference?.mode || '';

    enriched.push({
      ...row,
      inferred_domain: inference?.domain || '',
      inferred_website_url: inference?.websiteUrl || '',
      inferred_email: inference?.inferredEmail || '',
      inferred_email_candidates: inference?.candidates.join('|') || '',
      inference_mode: inference?.mode || '',
      inference_confidence: inference ? String(inference.confidence) : '',
      best_email: bestEmail,
      best_email_source: bestEmailSource,
    });
  }

  const summary: Summary = {
    total_rows: rows.length,
    rows_missing_contact_input: rowsMissingContactInput,
    rows_inferred_from_website_mx: rowsInferredFromWebsiteMx,
    rows_inferred_from_company_guess_semantic: rowsInferredFromCompanyGuessSemantic,
    rows_with_best_email_after_inference: enriched.filter((row) => row.best_email).length,
  };

  fs.writeFileSync(outputCsv, stringify(enriched, { header: true }), 'utf8');
  fs.writeFileSync(outputSummary, JSON.stringify(summary, null, 2), 'utf8');

  console.log(`[inference] wrote ${outputCsv}`);
  console.log(`[inference] wrote ${outputSummary}`);
  console.log(JSON.stringify(summary, null, 2));
}

void main().catch((error) => {
  console.error('[inference] fatal', error);
  process.exitCode = 1;
});
