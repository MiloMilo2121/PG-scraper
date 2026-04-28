import { describe, expect, it } from 'vitest';
import {
  AGENT_CONTRACT_VERSION,
  AgentScraperRequestSchema,
  emptyStats,
  mergeStats,
} from '../../src/agent/agent_contracts';
import { emptyCostSummary } from '../../src/agent/agent_costs';

describe('AgentScraperRequestSchema', () => {
  it('accepts a valid campaign request', () => {
    const parsed = AgentScraperRequestSchema.parse({
      runId: 'run-001',
      mode: 'campaign',
      sector: 'agenzie immobiliari',
      provinces: ['VR', 'VE'],
      limit: 100,
    });
    expect(parsed.contractVersion).toBe(AGENT_CONTRACT_VERSION);
    expect(parsed.mode).toBe('campaign');
    expect(parsed.provinces).toEqual(['VR', 'VE']);
  });

  it('accepts a valid enrichment request', () => {
    const parsed = AgentScraperRequestSchema.parse({
      runId: 'run-002',
      mode: 'enrichment',
      sourceCsv: '/tmp/input.csv',
    });
    expect(parsed.sourceCsv).toBe('/tmp/input.csv');
  });

  it('accepts agent governance context and budget guardrails', () => {
    const parsed = AgentScraperRequestSchema.parse({
      runId: 'run-governed',
      mode: 'enrichment',
      sourceCsv: '/tmp/input.csv',
      context: {
        workspaceId: 'workspace-1',
        agentId: 'codex-1',
        sessionId: 'session-1',
        actorType: 'agent',
        traceId: 'trace-1',
      },
      budget: {
        maxCostPerRun: 1,
        maxCostPerCompany: 0.01,
        maxExternalCalls: 10,
        maxRunDurationMs: 60_000,
      },
    });

    expect(parsed.context?.actorType).toBe('agent');
    expect(parsed.budget?.maxExternalCalls).toBe(10);
  });

  it('rejects unknown governance fields instead of silently ignoring them', () => {
    expect(() =>
      AgentScraperRequestSchema.parse({
        runId: 'run-governance-extra',
        mode: 'enrichment',
        sourceCsv: '/tmp/input.csv',
        context: {
          workspaceId: 'workspace-1',
          randomField: 'nope',
        },
      })
    ).toThrow();
  });

  it('rejects unknown mode', () => {
    expect(() =>
      AgentScraperRequestSchema.parse({
        runId: 'run-003',
        mode: 'wrong',
      })
    ).toThrow();
  });

  it('rejects campaign without sector', () => {
    expect(() =>
      AgentScraperRequestSchema.parse({
        runId: 'run-004',
        mode: 'campaign',
        provinces: ['VR'],
      })
    ).toThrow(/sector/);
  });

  it('rejects campaign without provinces / zone', () => {
    expect(() =>
      AgentScraperRequestSchema.parse({
        runId: 'run-005',
        mode: 'campaign',
        sector: 'dentisti',
      })
    ).toThrow(/provinces/);
  });

  it('rejects unsupported geo fields instead of silently ignoring them', () => {
    expect(() =>
      AgentScraperRequestSchema.parse({
        runId: 'run-geo-extra',
        mode: 'campaign',
        sector: 'dentisti',
        cities: ['Milano'],
      })
    ).toThrow();
  });

  it('rejects enrichment without sourceCsv', () => {
    expect(() =>
      AgentScraperRequestSchema.parse({
        runId: 'run-006',
        mode: 'enrichment',
      })
    ).toThrow(/sourceCsv/);
  });

  it('rejects runId with path traversal characters', () => {
    expect(() =>
      AgentScraperRequestSchema.parse({
        runId: '../etc',
        mode: 'enrichment',
        sourceCsv: '/tmp/x.csv',
      })
    ).toThrow();
  });
});

describe('stats helpers', () => {
  it('emptyStats returns zeroed counters', () => {
    expect(emptyStats()).toEqual({
      loaded: 0,
      discovered: 0,
      enriched: 0,
      failed: 0,
    });
  });

  it('mergeStats sums components', () => {
    const merged = mergeStats(
      { loaded: 1, discovered: 2, enriched: 3, failed: 4 },
      { loaded: 10, discovered: 20, enriched: 30, failed: 40 }
    );
    expect(merged).toEqual({ loaded: 11, discovered: 22, enriched: 33, failed: 44 });
  });
});

describe('cost helpers', () => {
  it('emptyCostSummary marks absent budget separately from zero cost within budget', () => {
    expect(emptyCostSummary().budgetStatus).toBe('not_configured');
    expect(emptyCostSummary({ maxCostPerRun: 0 }).budgetStatus).toBe('within_budget');
  });
});
