import { z } from 'zod';

export const AGENT_CONTRACT_VERSION = 'agent.v1' as const;

export const AgentRunModeSchema = z.enum(['campaign', 'enrichment', 'full']);
export type AgentRunMode = z.infer<typeof AgentRunModeSchema>;

export const AgentRunStatusSchema = z.enum(['queued', 'running', 'completed', 'failed']);
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;

const RUN_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export const AgentActorTypeSchema = z.enum(['human', 'agent', 'system', 'ci']);
export type AgentActorType = z.infer<typeof AgentActorTypeSchema>;

export const AgentRunContextSchema = z
  .object({
    workspaceId: z.string().trim().min(1).optional(),
    agentId: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1).optional(),
    actorType: AgentActorTypeSchema.optional(),
    traceId: z.string().trim().min(1).optional(),
  })
  .strict();
export type AgentRunContext = z.infer<typeof AgentRunContextSchema>;

export const AgentRunBudgetSchema = z
  .object({
    maxCostPerRun: z.number().nonnegative().optional(),
    maxCostPerCompany: z.number().nonnegative().optional(),
    maxExternalCalls: z.number().int().nonnegative().optional(),
    maxRunDurationMs: z.number().int().positive().optional(),
  })
  .strict();
export type AgentRunBudget = z.infer<typeof AgentRunBudgetSchema>;

export const AgentScraperRequestSchema = z
  .object({
    contractVersion: z.literal(AGENT_CONTRACT_VERSION).default(AGENT_CONTRACT_VERSION),
    runId: z
      .string()
      .regex(RUN_ID_PATTERN, 'runId must match [a-zA-Z0-9_-]{1,128}'),
    sector: z.string().trim().min(1).optional(),
    zone: z.string().trim().min(1).optional(),
    provinces: z.array(z.string().trim().min(1)).optional(),
    limit: z.number().int().positive().optional(),
    mode: AgentRunModeSchema,
    sourceCsv: z.string().trim().min(1).optional(),
    context: AgentRunContextSchema.optional(),
    budget: AgentRunBudgetSchema.optional(),
  })
  .strict()
  .superRefine((req, ctx) => {
    if (req.mode === 'campaign' || req.mode === 'full') {
      if (!req.sector) {
        ctx.addIssue({
          code: 'custom',
          path: ['sector'],
          message: `mode='${req.mode}' requires 'sector'`,
        });
      }
      const hasGeo =
        (req.provinces && req.provinces.length > 0) ||
        (req.zone && req.zone.length > 0);
      if (!hasGeo) {
        ctx.addIssue({
          code: 'custom',
          path: ['provinces'],
          message: `mode='${req.mode}' requires at least one of 'provinces' or 'zone'`,
        });
      }
    }
    if (req.mode === 'enrichment') {
      if (!req.sourceCsv) {
        ctx.addIssue({
          code: 'custom',
          path: ['sourceCsv'],
          message: "mode='enrichment' requires 'sourceCsv'",
        });
      }
    }
  });
export type AgentScraperRequest = z.infer<typeof AgentScraperRequestSchema>;

export const AgentStatsSchema = z.object({
  loaded: z.number().int().nonnegative(),
  discovered: z.number().int().nonnegative(),
  enriched: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type AgentStats = z.infer<typeof AgentStatsSchema>;

export const AgentArtifactsSchema = z.object({
  inputCsv: z.string().optional(),
  outputCsv: z.string().optional(),
  reportJson: z.string().optional(),
  logFile: z.string().optional(),
  costLedger: z.string().optional(),
});
export type AgentArtifacts = z.infer<typeof AgentArtifactsSchema>;

export const AgentBudgetStatusSchema = z.enum([
  'not_configured',
  'within_budget',
  'warning',
  'exceeded',
]);
export type AgentBudgetStatus = z.infer<typeof AgentBudgetStatusSchema>;

export const AgentCostSummarySchema = z.object({
  totalCostEur: z.number().nonnegative(),
  costPerCompanyEur: z.number().nonnegative(),
  externalCalls: z.number().int().nonnegative(),
  budgetStatus: AgentBudgetStatusSchema,
  warnings: z.array(z.string()),
});
export type AgentCostSummary = z.infer<typeof AgentCostSummarySchema>;

export const AgentRunErrorSchema = z.object({
  name: z.string(),
  message: z.string(),
  stack: z.string().optional(),
});
export type AgentRunError = z.infer<typeof AgentRunErrorSchema>;

export const AgentScraperResultSchema = z.object({
  runId: z.string(),
  status: AgentRunStatusSchema,
  input: AgentScraperRequestSchema,
  stats: AgentStatsSchema,
  artifacts: AgentArtifactsSchema,
  costSummary: AgentCostSummarySchema,
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  error: AgentRunErrorSchema.optional(),
});
export type AgentScraperResult = z.infer<typeof AgentScraperResultSchema>;

export const EMPTY_STATS: AgentStats = {
  loaded: 0,
  discovered: 0,
  enriched: 0,
  failed: 0,
};

export function emptyStats(): AgentStats {
  return { ...EMPTY_STATS };
}

export function mergeStats(a: AgentStats, b: AgentStats): AgentStats {
  return {
    loaded: a.loaded + b.loaded,
    discovered: a.discovered + b.discovered,
    enriched: a.enriched + b.enriched,
    failed: a.failed + b.failed,
  };
}
