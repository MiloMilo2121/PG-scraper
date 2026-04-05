import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  harvestByPhone: vi.fn(),
  hyperBlast: vi.fn(),
  rdapCheckDomainOwnership: vi.fn(),
  fattHarvest: vi.fn(),
}));

vi.mock('../../src/enricher/core/directories/paginegialle', () => ({
  PagineGialleHarvester: {
    harvestByPhone: mocks.harvestByPhone,
  },
}));

vi.mock('../../src/enricher/core/discovery/hyperguesser_vx/hyper_guesser_vx', () => ({
  HyperGuesserVX: {
    blast: mocks.hyperBlast,
  },
}));

vi.mock('../../src/enricher/core/discovery/rdap_validator', () => ({
  RdapValidator: {
    checkDomainOwnership: mocks.rdapCheckDomainOwnership,
  },
}));

vi.mock('../../src/enricher/core/directories/fatturato_italia', () => ({
  FatturatoItaliaHarvester: {
    harvest: mocks.fattHarvest,
  },
}));

import { InputNormalizer } from '../../src/foundation/InputNormalizer';
import { MasterPipeline } from '../../src/foundation/MasterPipeline';

interface SearchResult {
  title: string;
  snippet: string;
  url: string;
  source: string;
  normalized_url: string;
  domain: string;
}

function createPipeline(options?: {
  gateImpl?: (url: string) => Promise<string>;
  companyResults?: SearchResult[];
  registryResults?: SearchResult[];
  oracleDecision?: 'ORACLE_APPROVED' | 'ORACLE_SKIPPED';
  llmResults?: Array<{ title: string; snippet: string; url: string }>;
}) {
  const registry = {
    find: vi.fn().mockResolvedValue(null),
  };

  const gate = {
    check: vi.fn().mockImplementation(async (url: string) => {
      if (options?.gateImpl) {
        return options.gateImpl(url);
      }

      return 'NO_MATCH';
    }),
  };

  const dedup = {
    search: vi.fn().mockImplementation(async (_companyId: string, _input: unknown, target: string) => ({
      results: target === 'company' ? (options?.companyResults || []) : (options?.registryResults || []),
      linkedin_buffered: 0,
      queries_tried: [],
      providers_used: ['serper'],
    })),
  };

  const oracleGuard = {
    evaluate: vi.fn().mockResolvedValue(options?.oracleDecision ?? 'ORACLE_SKIPPED'),
  };

  const bleedingCtrl = {
    evaluateStatus: vi.fn().mockResolvedValue(false),
  };

  const valve = {
    execute: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  };

  const costRouter = {
    route: vi.fn().mockResolvedValue({
      data: options?.llmResults || [],
      provider: 'OPENROUTER-2',
      tier: 4,
      cost_eur: 0.001,
      duration_ms: 10,
      cache_hit: false,
      cache_level: 'MISS',
    }),
  };

  const pipeline = new MasterPipeline({
    normalizer: new InputNormalizer(),
    registry: registry as any,
    gate: gate as any,
    dedup: dedup as any,
    oracleGuard: oracleGuard as any,
    bleedingCtrl: bleedingCtrl as any,
    valve: valve as any,
    bilancioHunter: { hunt: vi.fn().mockResolvedValue(null) } as any,
    linkedinSniper: { snipeDetailed: vi.fn().mockResolvedValue({ decisionMaker: null, attempted_count: 0, evidence_count: 0, entity_match_status: 'unknown', providers: [], detail: 'not used' }) } as any,
    browserPool: { navigateSafe: vi.fn().mockResolvedValue({ status: 'BLOCKED' }) } as any,
    costRouter: costRouter as any,
    postProcessor: { estimateEmployees: vi.fn().mockResolvedValue(null) } as any,
    pecHunter: { hunt: vi.fn().mockResolvedValue(null) } as any,
  });

  return { pipeline, gate, dedup, oracleGuard, costRouter };
}

describe('MasterPipeline stage-6 oracle coherence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.harvestByPhone.mockResolvedValue(null);
    mocks.hyperBlast.mockResolvedValue(null);
    mocks.rdapCheckDomainOwnership.mockResolvedValue(0);
    mocks.fattHarvest.mockResolvedValue(null);
  });

  it('feeds real deterministic candidate stats into the oracle guard', async () => {
    const { pipeline, oracleGuard, costRouter } = createPipeline({
      companyResults: [{
        title: 'ACME S.R.L. Contatti',
        snippet: 'Contatti ufficiali ACME S.R.L.',
        url: 'https://shop.acme.it/landing',
        source: 'serper',
        normalized_url: 'https://shop.acme.it/landing',
        domain: 'shop.acme.it',
      }],
      oracleDecision: 'ORACLE_SKIPPED',
    });

    const result = await pipeline.processCompany({
      company_name: 'ACME S.R.L.',
      city: 'Milano',
    }, 0);

    expect(result.status).toBe('NOT_FOUND');
    expect(oracleGuard.evaluate).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      candidates_count: 1,
      highest_confidence: expect.any(Number),
      has_rs: true,
      has_address: true,
    }));
    const [, guardConditions] = oracleGuard.evaluate.mock.calls[0];
    expect(guardConditions.highest_confidence).toBeGreaterThan(0);
    expect(guardConditions.highest_confidence).toBeLessThan(0.4);
    expect(costRouter.route).not.toHaveBeenCalled();
  });

  it('does not accept unrelated oracle candidates purely because the provider tier is high', async () => {
    const { pipeline, costRouter } = createPipeline({
      companyResults: [{
        title: 'ACME S.R.L. Contatti',
        snippet: 'Contatti ufficiali ACME S.R.L.',
        url: 'https://shop.acme.it/landing',
        source: 'serper',
        normalized_url: 'https://shop.acme.it/landing',
        domain: 'shop.acme.it',
      }],
      oracleDecision: 'ORACLE_APPROVED',
      llmResults: [{
        title: 'Totally Different Company',
        snippet: 'Official site',
        url: 'https://totally-different.it',
      }],
    });

    const result = await pipeline.processCompany({
      company_name: 'ACME S.R.L.',
      city: 'Milano',
    }, 0);

    expect(costRouter.route).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('NOT_FOUND');
    expect(result.website).toBeUndefined();
  });

  it('allows semantic oracle acceptance only when the returned candidate corroborates a tracked weak seed', async () => {
    const { pipeline, costRouter } = createPipeline({
      companyResults: [{
        title: 'ACME S.R.L. Contatti',
        snippet: 'Contatti ufficiali ACME S.R.L.',
        url: 'https://shop.acme.it/landing',
        source: 'serper',
        normalized_url: 'https://shop.acme.it/landing',
        domain: 'shop.acme.it',
      }],
      oracleDecision: 'ORACLE_APPROVED',
      llmResults: [{
        title: 'ACME S.R.L. Official Site',
        snippet: 'Sito ufficiale ACME S.R.L.',
        url: 'https://acme.it',
      }],
    });

    const result = await pipeline.processCompany({
      company_name: 'ACME S.R.L.',
      city: 'Milano',
    }, 0);

    expect(costRouter.route).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('FOUND_COMPLETE');
    expect(result.website.url).toBe('https://acme.it/');
    expect(result.website.discovery_layer).toBe('LLM_ORACLE_SEMANTIC');
  });
});
