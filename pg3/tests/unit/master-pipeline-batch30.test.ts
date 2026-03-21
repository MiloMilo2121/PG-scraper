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

type MockLane =
  | 'input_direct'
  | 'input_subdomain'
  | 'email_domain'
  | 'phone_entity'
  | 'serp_company'
  | 'registry_extract'
  | 'serp_rdap'
  | 'llm_oracle';

interface MockScenario {
  companyName: string;
  rootDomain: string;
  lane: MockLane;
  rawInput: Record<string, string>;
  expectedUrl: string;
  expectedLayer: string;
  gateSuccessUrls: string[];
  pgHarvest?: Record<string, string>;
  companyResults?: Array<{
    title: string;
    snippet: string;
    url: string;
    source: string;
    normalized_url: string;
    domain: string;
  }>;
  registryResults?: Array<{
    title: string;
    snippet: string;
    url: string;
    source: string;
    normalized_url: string;
    domain: string;
  }>;
  rdapScore?: number;
  llmResults?: Array<{ title: string; snippet: string; url: string }>;
}

function pad(num: number): string {
  return String(num).padStart(2, '0');
}

function buildScenario(index: number, lane: MockLane): MockScenario {
  const suffix = pad(index);
  const companyName = `Mock Company ${suffix} S.R.L.`;
  const rootDomain = `mock${suffix}.it`;
  const city = index % 2 === 0 ? 'Milano' : 'Bergamo';
  const baseInput = {
    company_name: companyName,
    city,
  };

  if (lane === 'input_direct') {
    return {
      companyName,
      rootDomain,
      lane,
      rawInput: {
        ...baseInput,
        website: `https://${rootDomain}/contatti`,
      },
      expectedUrl: `https://${rootDomain}/contatti`,
      expectedLayer: 'INPUT_WEBSITE_SEMANTIC',
      gateSuccessUrls: [`https://${rootDomain}/contatti`],
    };
  }

  if (lane === 'input_subdomain') {
    return {
      companyName,
      rootDomain,
      lane,
      rawInput: {
        ...baseInput,
        website: `https://shop.${rootDomain}/contatti`,
      },
      expectedUrl: `https://${rootDomain}`,
      expectedLayer: 'INPUT_WEBSITE_SEMANTIC',
      gateSuccessUrls: [`https://${rootDomain}`],
    };
  }

  if (lane === 'email_domain') {
    return {
      companyName,
      rootDomain,
      lane,
      rawInput: {
        ...baseInput,
        email: `info@mail.${rootDomain}`,
      },
      expectedUrl: `https://${rootDomain}`,
      expectedLayer: 'EMAIL_DOMAIN_SEMANTIC',
      gateSuccessUrls: [`https://${rootDomain}`],
    };
  }

  if (lane === 'phone_entity') {
    return {
      companyName,
      rootDomain,
      lane,
      rawInput: {
        ...baseInput,
        phone: '02 1234567',
      },
      expectedUrl: `https://${rootDomain}`,
      expectedLayer: 'PG_PHONE_SEMANTIC',
      gateSuccessUrls: [`https://${rootDomain}`],
      pgHarvest: {
        pgUrl: `https://www.paginegialle.it/${rootDomain.replace('.it', '')}`,
        officialWebsite: `https://shop.${rootDomain}/contatti`,
        matchedBy: 'phone',
      },
    };
  }

  if (lane === 'serp_company') {
    return {
      companyName,
      rootDomain,
      lane,
      rawInput: baseInput,
      expectedUrl: `https://${rootDomain}`,
      expectedLayer: 'SERP_COMPANY_SEMANTIC',
      gateSuccessUrls: [`https://${rootDomain}`],
      companyResults: [{
        title: `${companyName} Contatti`,
        snippet: `Contatti ufficiali ${companyName}`,
        url: `https://shop.${rootDomain}/contatti`,
        source: 'ddg',
        normalized_url: `https://shop.${rootDomain}/contatti`,
        domain: `shop.${rootDomain}`,
      }],
    };
  }

  if (lane === 'registry_extract') {
    return {
      companyName,
      rootDomain,
      lane,
      rawInput: baseInput,
      expectedUrl: `https://${rootDomain}`,
      expectedLayer: 'REGISTRY_EXTRACT_SEMANTIC',
      gateSuccessUrls: [`https://${rootDomain}`],
      registryResults: [{
        title: `${companyName} | Registro Imprese`,
        snippet: `Sito web: www.${rootDomain} | Email: info@${rootDomain}`,
        url: `https://www.registroimprese.it/${rootDomain.replace('.it', '')}`,
        source: 'ddg',
        normalized_url: `https://registroimprese.it/${rootDomain.replace('.it', '')}`,
        domain: 'registroimprese.it',
      }],
    };
  }

  if (lane === 'serp_rdap') {
    return {
      companyName,
      rootDomain,
      lane,
      rawInput: baseInput,
      expectedUrl: `https://www.${rootDomain}/azienda`,
      expectedLayer: 'SERP_RDAP_BINGO',
      gateSuccessUrls: [],
      rdapScore: 0.9,
      companyResults: [{
        title: `${companyName} Azienda`,
        snippet: `Chi siamo ${companyName}`,
        url: `https://www.${rootDomain}/azienda`,
        source: 'ddg',
        normalized_url: `https://${rootDomain}/azienda`,
        domain: rootDomain,
      }],
    };
  }

  return {
    companyName,
    rootDomain,
    lane: 'llm_oracle',
    rawInput: baseInput,
    expectedUrl: `https://${rootDomain}`,
    expectedLayer: 'LLM_ORACLE_SEMANTIC',
    gateSuccessUrls: [`https://${rootDomain}`],
    llmResults: [{
      title: `${companyName} Official Site`,
      snippet: `Sito ufficiale ${companyName}`,
      url: `https://shop.${rootDomain}/landing`,
    }],
  };
}

function buildScenarios(): MockScenario[] {
  const scenarios: MockScenario[] = [];

  for (let index = 1; index <= 4; index += 1) {
    scenarios.push(buildScenario(index, 'input_direct'));
  }

  for (let index = 5; index <= 8; index += 1) {
    scenarios.push(buildScenario(index, 'input_subdomain'));
  }

  for (let index = 9; index <= 12; index += 1) {
    scenarios.push(buildScenario(index, 'email_domain'));
  }

  for (let index = 13; index <= 16; index += 1) {
    scenarios.push(buildScenario(index, 'phone_entity'));
  }

  for (let index = 17; index <= 24; index += 1) {
    scenarios.push(buildScenario(index, 'serp_company'));
  }

  for (let index = 25; index <= 27; index += 1) {
    scenarios.push(buildScenario(index, 'registry_extract'));
  }

  for (let index = 28; index <= 29; index += 1) {
    scenarios.push(buildScenario(index, 'serp_rdap'));
  }

  scenarios.push(buildScenario(30, 'llm_oracle'));
  return scenarios;
}

function createPipeline(scenarios: MockScenario[]) {
  const scenarioMap = new Map(scenarios.map((scenario) => [scenario.companyName, scenario]));

  const registry = {
    find: vi.fn().mockResolvedValue(null),
  };

  const gate = {
    check: vi.fn().mockImplementation(async (url: string, _piva: string | undefined, companyName?: string) => {
      const scenario = companyName ? scenarioMap.get(companyName) : undefined;
      if (!scenario) {
        return 'NO_MATCH';
      }

      return scenario.gateSuccessUrls.includes(url) ? 'VERIFIED_SEMANTIC' : 'NO_MATCH';
    }),
  };

  const dedup = {
    search: vi.fn().mockImplementation(async (_companyId: string, input: { company_name: string }, target: string) => {
      const scenario = scenarioMap.get(input.company_name);
      if (!scenario) {
        return { results: [], linkedin_buffered: 0, queries_tried: [], providers_used: [] };
      }

      if (target === 'company') {
        return {
          results: scenario.companyResults || [],
          linkedin_buffered: 0,
          queries_tried: [`"${scenario.companyName}" sito ufficiale`],
          providers_used: scenario.companyResults?.length ? ['jina'] : [],
        };
      }

      if (target === 'registry') {
        return {
          results: scenario.registryResults || [],
          linkedin_buffered: 0,
          queries_tried: [`"${scenario.companyName}" registro imprese`],
          providers_used: scenario.registryResults?.length ? ['jina'] : [],
        };
      }

      return { results: [], linkedin_buffered: 0, queries_tried: [], providers_used: [] };
    }),
  };

  const oracleGuard = {
    evaluate: vi.fn().mockResolvedValue('ORACLE_APPROVED'),
  };

  const bleedingCtrl = {
    evaluateStatus: vi.fn().mockResolvedValue(false),
  };

  const valve = {
    execute: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  };

  const costRouter = {
    route: vi.fn().mockImplementation(async (_family: string, payload: { query?: string }) => {
      const scenario = scenarios.find((candidate) => payload?.query?.includes(candidate.companyName));

      return {
        data: scenario?.llmResults || [],
        provider: scenario?.llmResults?.length ? 'mock-llm' : 'mock-empty',
        tier: 4,
      };
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
    linkedinSniper: { snipe: vi.fn().mockResolvedValue(null) } as any,
    browserPool: { navigateSafe: vi.fn().mockResolvedValue({ status: 'BLOCKED' }) } as any,
    costRouter: costRouter as any,
    postProcessor: { estimateEmployees: vi.fn().mockResolvedValue(null) } as any,
    pecHunter: { hunt: vi.fn().mockResolvedValue(null) } as any,
  });

  return { pipeline, gate, dedup, costRouter };
}

describe('MasterPipeline 30-company mock batch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hyperBlast.mockResolvedValue(null);
    mocks.fattHarvest.mockResolvedValue(null);
  });

  it('processes 30 mocked companies through the full discovery stack with deterministic lane coverage', async () => {
    const scenarios = buildScenarios();
    const { pipeline, gate, dedup, costRouter } = createPipeline(scenarios);
    const scenarioMap = new Map(scenarios.map((scenario) => [scenario.companyName, scenario]));

    mocks.harvestByPhone.mockImplementation(async (input: { company_name: string }) => {
      return scenarioMap.get(input.company_name)?.pgHarvest || null;
    });

    mocks.rdapCheckDomainOwnership.mockImplementation(async (candidateUrl: string, input: { company_name: string }) => {
      const scenario = scenarioMap.get(input.company_name);
      if (!scenario?.rdapScore) {
        return 0;
      }

      return candidateUrl.includes(scenario.rootDomain) ? scenario.rdapScore : 0;
    });

    const results = [];
    for (const [index, scenario] of scenarios.entries()) {
      // Run sequentially to keep summary output deterministic and easier to audit.
      const result = await pipeline.processCompany(scenario.rawInput, index);
      results.push(result);
    }

    const discovered = results.filter((result) => result.status === 'FOUND_COMPLETE');
    const notFound = results.filter((result) => result.status !== 'FOUND_COMPLETE');
    const layerCounts = discovered.reduce<Record<string, number>>((acc, result) => {
      const layer = result.website?.discovery_layer || 'UNKNOWN';
      acc[layer] = (acc[layer] || 0) + 1;
      return acc;
    }, {});

    for (const result of results) {
      const scenario = scenarioMap.get(result.input.company_name);
      expect(scenario).toBeDefined();
      expect(result.status).toBe('FOUND_COMPLETE');
      expect(result.website.url).toBe(scenario?.expectedUrl);
      expect(result.website.discovery_layer).toBe(scenario?.expectedLayer);
    }

    expect(results).toHaveLength(30);
    expect(discovered).toHaveLength(30);
    expect(notFound).toHaveLength(0);
    expect(layerCounts).toEqual({
      INPUT_WEBSITE_SEMANTIC: 8,
      EMAIL_DOMAIN_SEMANTIC: 4,
      PG_PHONE_SEMANTIC: 4,
      SERP_COMPANY_SEMANTIC: 8,
      REGISTRY_EXTRACT_SEMANTIC: 3,
      SERP_RDAP_BINGO: 2,
      LLM_ORACLE_SEMANTIC: 1,
    });

    expect(gate.check).toHaveBeenCalled();
    expect(dedup.search).toHaveBeenCalled();
    expect(costRouter.route).toHaveBeenCalledTimes(1);
    expect(mocks.harvestByPhone).toHaveBeenCalledTimes(4);
    expect(mocks.rdapCheckDomainOwnership).toHaveBeenCalledTimes(2);

    console.log('[Mock30] Website discovery summary', JSON.stringify({
      total: results.length,
      found: discovered.length,
      layers: layerCounts,
    }));
  });
});
