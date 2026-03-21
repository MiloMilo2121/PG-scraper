/**
 * 📥 SCHEDULER - Job Producer
 * Loads companies from CSV and adds to BullMQ queue.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import { QueueEvents } from 'bullmq';
import { parse } from 'fast-csv';
import { Logger } from './utils/logger';
import { config } from './config';
import { Company, initializeDatabase, insertCompanies } from './db';
import {
  CSVCompany,
  CsvCompanySchema,
  createCsvLoadDiagnostics,
  normalizeCsvRowForScheduler,
  pushIssue,
} from './scheduler_csv';
import {
  enrichmentQueue,
  addJobsBatch,
  EnrichmentJobData,
  createQueueEvents,
  QUEUE_NAMES,
  closeQueueResources,
  redisConnection,
} from './queue';

const INPUT_FILE = process.argv[3] || 'output/campaigns/BOARD_FINAL_SANITISED.csv';
const SCHEDULER_LOCK_KEY = process.env.SCHEDULER_LOCK_KEY || `${config.queue.prefix}:${QUEUE_NAMES.ENRICHMENT}:scheduler:lock`;
const SCHEDULER_LOCK_TTL_MS = config.queue.schedulerLockTtlMs;
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;
let activeSchedulerRuns = 0;

export interface SchedulerSummary {
  loaded: number;
  enqueued: number;
  skipped: number;
  durationMs: number;
}

function deterministicCompanyId(company: CSVCompany): string {
  if (company.company_id && company.company_id.trim() !== '') {
    return company.company_id.trim();
  }

  return crypto
    .createHash('md5')
    // Phone is the strongest stable identifier when present. City can be a "hub" city and be wrong.
    .update(
      [
        company.company_name,
        (company.phone || '').replace(/\D/g, ''),
        company.city || '',
        company.address || '',
      ].join('|')
    )
    .digest('hex');
}

function mapCompaniesToJobs(companies: CSVCompany[], runId: string): { jobs: EnrichmentJobData[]; skipped: number } {
  const uniqueJobs = new Map<string, EnrichmentJobData>();

  for (const c of companies) {
    const companyName = c.company_name.trim();
    if (!companyName) {
      continue;
    }

    const companyId = deterministicCompanyId(c);
    if (uniqueJobs.has(companyId)) {
      continue;
    }

    uniqueJobs.set(companyId, {
      company_id: companyId,
      company_name: companyName,
      city: c.city?.trim() || undefined,
      province: c.province?.trim() || undefined,
      zip_code: c.zip_code?.trim() || undefined,
      region: c.region?.trim() || undefined,
      address: c.address?.trim() || undefined,
      phone: c.phone?.trim() || undefined,
      website: c.website?.trim() || undefined,
      category: c.category?.trim() || undefined,
      source: c.source?.trim() || undefined,
      vat_code: c.vat_code?.trim() || undefined,
      pg_url: c.pg_url?.trim() || undefined,
      email: c.email?.trim() || undefined,
      run_id: runId,
      correlation_id: `${runId}:${companyId}`,
    });
  }

  return {
    jobs: Array.from(uniqueJobs.values()),
    skipped: Math.max(companies.length - uniqueJobs.size, 0),
  };
}

function mapJobsToDbCompanies(jobs: EnrichmentJobData[]): Company[] {
  return jobs.map((job) => ({
    id: job.company_id,
    company_name: job.company_name,
    city: job.city,
    province: job.province,
    zip_code: job.zip_code,
    region: job.region,
    address: job.address,
    phone: job.phone,
    website: job.website,
    category: job.category,
    source: job.source,
    vat_code: job.vat_code,
    pg_url: job.pg_url,
    email: job.email,
  }));
}

async function loadCompaniesFromCSV(filePath: string): Promise<CSVCompany[]> {
  if (!fs.existsSync(filePath)) {
    Logger.error(`❌ Input file not found: ${filePath}`);
    return [];
  }

  return new Promise((resolve) => {
    const rows: CSVCompany[] = [];
    const diagnostics = createCsvLoadDiagnostics();

    fs.createReadStream(filePath)
      .pipe(parse({ headers: true, ignoreEmpty: true }))
      .on('data', (row: Record<string, unknown>) => {
        diagnostics.totalRows += 1;
        const normalized = normalizeCsvRowForScheduler(row, diagnostics);

        if (!normalized.company_name || normalized.company_name.trim() === '') {
          diagnostics.skippedRows += 1;
          diagnostics.skippedMissingCompanyName += 1;
          pushIssue(diagnostics, `row ${diagnostics.totalRows}: missing company_name`);
          return;
        }

        const parsed = CsvCompanySchema.safeParse(normalized);
        if (!parsed.success) {
          diagnostics.skippedRows += 1;
          diagnostics.skippedInvalidRows += 1;
          const issueSummary = parsed.error.issues
            .slice(0, 2)
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ');
          pushIssue(diagnostics, `row ${diagnostics.totalRows}: ${issueSummary}`);
          return;
        }

        diagnostics.acceptedRows += 1;
        rows.push({
          ...parsed.data,
          company_name: parsed.data.company_name.trim(),
        });
      })
      .on('end', () => {
        Logger.info('📄 CSV load diagnostics', {
          total_rows: diagnostics.totalRows,
          accepted_rows: diagnostics.acceptedRows,
          skipped_rows: diagnostics.skippedRows,
          skipped_missing_company_name: diagnostics.skippedMissingCompanyName,
          skipped_invalid_rows: diagnostics.skippedInvalidRows,
          alias_hits: diagnostics.aliasHits,
          unmapped_headers_count: diagnostics.unknownHeaders.size,
        });

        if (diagnostics.unknownHeaders.size > 0) {
          Logger.warn('CSV contains unmapped headers (ignored)', {
            headers: Array.from(diagnostics.unknownHeaders).slice(0, 20),
          });
        }

        if (diagnostics.sampleIssues.length > 0) {
          Logger.warn('Sample of skipped CSV rows', {
            issues: diagnostics.sampleIssues,
          });
        }

        resolve(rows);
      })
      .on('error', (err) => {
        Logger.error('CSV parsing error', { error: err });
        resolve([]);
      });
  });
}

async function acquireSchedulerLock(): Promise<string | null> {
  const lockToken = crypto.randomUUID();
  const result = await redisConnection.set(
    SCHEDULER_LOCK_KEY,
    lockToken,
    'PX',
    SCHEDULER_LOCK_TTL_MS,
    'NX'
  );
  return result === 'OK' ? lockToken : null;
}

async function releaseSchedulerLock(lockToken: string): Promise<void> {
  await redisConnection.eval(RELEASE_LOCK_SCRIPT, 1, SCHEDULER_LOCK_KEY, lockToken);
}

export async function runScheduler(csvPath?: string): Promise<SchedulerSummary> {
    const startedAt = Date.now();
    const inputFile = csvPath || INPUT_FILE;
    const runId = `run-${startedAt}-${crypto.randomUUID().slice(0, 8)}`;
    let events: QueueEvents | null = null;
    let lockToken: string | null = null;

    initializeDatabase();
    activeSchedulerRuns += 1;

  try {
    lockToken = await acquireSchedulerLock();
    if (!lockToken) {
      Logger.warn('⚠️ Scheduler overlap detected. Another scheduler instance is already running.');
      return {
        loaded: 0,
        enqueued: 0,
        skipped: 0,
        durationMs: Date.now() - startedAt,
      };
    }

    Logger.info('📥 SCHEDULER: Starting job injection', { run_id: runId });
    events = createQueueEvents(QUEUE_NAMES.ENRICHMENT);

    const companies = await loadCompaniesFromCSV(inputFile);
    Logger.info(`📊 Loaded ${companies.length} companies from ${inputFile}`);

    const queueCounts = await enrichmentQueue.getJobCounts();
    Logger.info(
      `📋 Queue state: ${queueCounts.waiting} waiting, ${queueCounts.active} active, ${queueCounts.completed} completed`
    );

    const { jobs, skipped } = mapCompaniesToJobs(companies, runId);

    if (jobs.length === 0) {
      Logger.warn('⚠️ No companies to process.');
      return {
        loaded: companies.length,
        enqueued: 0,
        skipped,
        durationMs: Date.now() - startedAt,
      };
    }

    insertCompanies(mapJobsToDbCompanies(jobs));
    const enqueued = await addJobsBatch(enrichmentQueue, jobs);

    Logger.info(`✅ SCHEDULER: Injected ${enqueued} jobs to queue`, { run_id: runId });

    return {
      loaded: companies.length,
      enqueued,
      skipped,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    if (events) {
      await events.close().catch((error: unknown) => {
        Logger.warn('QueueEvents close failed', { error: error as Error });
      });
    }

    if (lockToken) {
      await releaseSchedulerLock(lockToken).catch((error: unknown) => {
        Logger.warn('Scheduler lock release failed', { error: error as Error });
      });
    }

    activeSchedulerRuns = Math.max(activeSchedulerRuns - 1, 0);
    if (activeSchedulerRuns === 0) {
      await closeQueueResources();
    }
  }
}

async function main(): Promise<void> {
  const csvPath = process.argv[3] || process.argv[2];
  const summary = await runScheduler(csvPath);

  Logger.info('📥 SCHEDULER: Complete', {
    loaded: summary.loaded,
    enqueued: summary.enqueued,
    skipped: summary.skipped,
    duration_ms: summary.durationMs,
  });
}

if (require.main === module) {
  main().catch((err) => {
    Logger.fatal('Scheduler crashed', { error: err as Error });
    process.exit(1);
  });
}
