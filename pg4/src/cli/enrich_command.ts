import { logger } from '../runtime/logger';
import { readCsvAsLeads } from '../io/csv_reader';
import { OutputManager } from '../io/output_manager';
import { createRun, createPerLeadContext } from '../runtime/run_context';
import { buildProviderCatalog } from '../providers/provider_catalog';
import { runEnrichmentPipeline } from '../enrichment/enrichment_pipeline';
import { PgDetailHarvester } from '../discovery/sources/pagine_gialle_detail_harvester';
import { acquireOutputLock } from '../runtime/output_lock';
import { buildMockHttpRouter, buildNoopPgDetailHarvester } from './mock_http';
import { getNotifier } from '../runtime/notifier';

/**
 * Phase B.1 — the enrich core, extracted from the CLI so the `run` command
 * can chain scrape → enrich with one shared run id and so tests can drive
 * the full command without spawning a process.
 *
 * Owns: output lock, run context, provider router, concurrency loop,
 * ledger summary, cost-event notifications. Does NOT own: arg parsing,
 * run-record lifecycle, exit codes — those stay in the CLI wrapper.
 */

export interface EnrichCommandOptions {
  input: string;
  csvOut: string;
  mockHttpPath?: string;
  ledgerPath?: string;
  costCeilingEur?: number;
  runCostCeilingEur?: number;
  enablePaid?: boolean;
  /** Phase B.1 — shared run id from the `run` command. */
  runId?: string;
  /** Phase B.5 — cooperative cancellation. */
  abortSignal?: AbortSignal;
}

export interface EnrichCommandResult {
  runId: string;
  total: number;
  withWebsite: number;
  errors: number;
  totalCostEur: number;
  /** Leads whose per-lead paid budget was exhausted mid-pipeline. */
  budgetExhaustedLeads: number;
  jsonlOut: string;
  ledgerPath: string;
  interrupted: boolean;
}

export async function runEnrichCommand(o: EnrichCommandOptions): Promise<EnrichCommandResult> {
  const jsonlOut = o.csvOut.replace(/\.csv$/i, '') + '.jsonl';
  const ledgerPath = o.ledgerPath ?? o.csvOut.replace(/\.csv$/i, '') + '.cost-ledger.jsonl';
  const outputLock = acquireOutputLock(o.csvOut, { input: o.input, jsonlOut, ledgerPath, command: 'enrich' });
  try {
    // Phase G — paid providers gate. Default DENY: paid is off unless
    // `--enable-paid` is passed. The cost-ceiling-eur=0 path also
    // forces paid off as an extra safety, so an operator can run
    // "free regression" by setting the ceiling to 0 even if they
    // forgot to drop --enable-paid.
    const paidEnabled = o.enablePaid === true && (o.costCeilingEur === undefined || o.costCeilingEur > 0);
    if (o.enablePaid && !paidEnabled) {
      logger.warn(
        { costCeiling: o.costCeilingEur },
        '[enrich] --enable-paid is ignored because --cost-ceiling-eur is 0; force-OFF paid for this run',
      );
    }
    const run = createRun({
      ledgerJsonlPath: ledgerPath,
      costCeilingEur: o.costCeilingEur,
      paidEnabled,
      runCostCeilingEur: o.runCostCeilingEur,
      runId: o.runId,
      abortSignal: o.abortSignal,
    });
    const notifier = getNotifier();
    const router = o.mockHttpPath ? buildMockHttpRouter(run.ledger, o.mockHttpPath) : buildProviderCatalog(run.ledger);
    // Phase A.5 — run-ceiling event. The router latches: fires once.
    router.setRunCeilingListener(({ ledgerTotalEur, ceilingEur }) => {
      notifier.notify({
        kind: 'run_cost_ceiling_hit',
        title: 'Run cost ceiling reached',
        body: `Paid providers disabled for the rest of the run (spent €${ledgerTotalEur.toFixed(4)} of €${ceilingEur}).`,
        meta: { run_id: run.ctx.runId, ledger_total_eur: ledgerTotalEur, ceiling_eur: ceilingEur },
      });
    });
    const dnsResolver = o.mockHttpPath ? async (_host: string): Promise<string[]> => [] : undefined;
    // R1 — shared harvester so duplicate `pg_url`s across leads only
    // hit the network once per run.
    const pgHarvester = o.mockHttpPath ? buildNoopPgDetailHarvester() : new PgDetailHarvester();

    const output = new OutputManager(o.csvOut, jsonlOut, 'enriched');
    logger.info(
      {
        runId: run.ctx.runId,
        input: o.input,
        csvOut: o.csvOut,
        paidEnabled,
        costCeilingEur: o.costCeilingEur,
        runCostCeilingEur: o.runCostCeilingEur,
      },
      '[enrich] starting',
    );
    if (o.mockHttpPath) {
      logger.info({ mockHttpPath: o.mockHttpPath }, '[enrich] using offline mock HTTP fixture');
    }

    let total = 0;
    let withWebsite = 0;
    let errors = 0;
    let budgetExhaustedLeads = 0;
    let firstBudgetNotified = false;
    let interrupted = false;
    const inFlight: Promise<void>[] = [];
    const concurrency = run.cfg.pipeline.concurrency;

    for await (const item of readCsvAsLeads(o.input)) {
      // Phase B.5 — cooperative abort: stop ingesting new rows; the
      // in-flight drain below finishes the rows already started so the
      // CSV/JSONL stay parseable and the ledger summary is written.
      if (o.abortSignal?.aborted) {
        interrupted = true;
        break;
      }
      total += 1;
      const task = (async () => {
        const perLead = createPerLeadContext(run);
        try {
          const result = await runEnrichmentPipeline({
            run,
            perLead,
            router,
            lead: item.lead,
            ingestError: item.ingestError,
            dnsResolver,
            pgHarvester,
          });
          if (result.lead.official_website) withWebsite += 1;
          await output.write(result.lead, { stage_outcomes: result.stage_outcomes });
        } catch (err) {
          errors += 1;
          logger.error({ line: item.lineNumber, err: (err as Error).message }, '[enrich] row failed');
          await output.write({ ...item.lead, status: 'ERROR', reason_code: 'ERROR_INTERNAL', errors: [{ stage: 'pipeline', message: (err as Error).message }] });
        } finally {
          if (perLead.budgetExhausted) {
            budgetExhaustedLeads += 1;
            // Phase A.5 — per-lead ceiling event, notified once per run
            // (many leads legitimately exhaust their budget; one ping is
            // signal, N pings are spam). The full count lands in the
            // ledger summary + run record.
            if (!firstBudgetNotified) {
              firstBudgetNotified = true;
              notifier.notify({
                kind: 'cost_ceiling_hit',
                title: 'Per-lead cost ceiling hit',
                body: `At least one lead exhausted its paid budget (€${run.ctx.costCeilingEur}); further leads may follow (count in run summary).`,
                meta: { run_id: run.ctx.runId, ceiling_eur: run.ctx.costCeilingEur },
              });
            }
          }
        }
      })().finally(() => {
        const idx = inFlight.indexOf(task);
        if (idx >= 0) inFlight.splice(idx, 1);
      });
      inFlight.push(task);
      if (inFlight.length >= concurrency) {
        await Promise.race(inFlight);
      }
    }

    await Promise.all(inFlight);
    await output.close();
    run.ledger.flushSummary({
      leads_processed: total,
      leads_with_website: withWebsite,
      leads_errored: errors,
      leads_budget_exhausted: budgetExhaustedLeads,
      interrupted,
      cost_per_lead_eur: total > 0 ? run.ledger.getTotal() / total : 0,
      cost_ceiling_eur: run.ctx.costCeilingEur,
      breaker: router.describeBreaker(),
    });

    return {
      runId: run.ctx.runId,
      total,
      withWebsite,
      errors,
      totalCostEur: run.ledger.getTotal(),
      budgetExhaustedLeads,
      jsonlOut,
      ledgerPath,
      interrupted,
    };
  } finally {
    outputLock.release();
  }
}
