import { describe, expect, it } from 'vitest';
import {
  AgentScraperRequestSchema,
  emptyStats,
  mergeStats,
} from '../../src/agent/agent_contracts';

describe('AgentScraperRequestSchema', () => {
  it('accepts a valid campaign request', () => {
    const parsed = AgentScraperRequestSchema.parse({
      runId: 'run-001',
      mode: 'campaign',
      sector: 'agenzie immobiliari',
      provinces: ['VR', 'VE'],
      limit: 100,
    });
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

  it('rejects campaign without provinces / cities / zone', () => {
    expect(() =>
      AgentScraperRequestSchema.parse({
        runId: 'run-005',
        mode: 'campaign',
        sector: 'dentisti',
      })
    ).toThrow(/provinces/);
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
