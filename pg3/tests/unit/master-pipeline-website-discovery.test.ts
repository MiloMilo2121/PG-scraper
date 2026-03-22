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

function createPipeline(gateImpl?: (url: string) => Promise<string>) {
  const registry = {
    find: vi.fn().mockResolvedValue(null),
  };

  const gate = {
    check: vi.fn().mockImplementation(async (url: string) => {
      if (gateImpl) {
        return gateImpl(url);
      }

      return 'NO_MATCH';
    }),
  };

  const dedup = {
    search: vi.fn().mockResolvedValue({
      results: [],
      linkedin_buffered: 0,
      queries_tried: [],
      providers_used: [],
    }),
  };

  const oracleGuard = {
    evaluate: vi.fn().mockResolvedValue('ORACLE_SKIPPED'),
  };

  const bleedingCtrl = {
    evaluateStatus: vi.fn().mockResolvedValue(false),
  };

  const valve = {
    execute: vi.fn(async (fn: () => Promise<unknown>) => fn()),
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
    costRouter: { route: vi.fn() } as any,
    postProcessor: { estimateEmployees: vi.fn().mockResolvedValue(null) } as any,
    pecHunter: { hunt: vi.fn().mockResolvedValue(null) } as any,
  });

  return { pipeline, gate, dedup };
}

describe('MasterPipeline website discovery recall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.harvestByPhone.mockResolvedValue(null);
    mocks.hyperBlast.mockResolvedValue(null);
    mocks.rdapCheckDomainOwnership.mockResolvedValue(0);
    mocks.fattHarvest.mockResolvedValue(null);
  });

  it('falls back from email subdomains to the registrable root domain before SERP', async () => {
    const { pipeline, gate, dedup } = createPipeline(async (url: string) =>
      url === 'https://acme.it' ? 'VERIFIED_SEMANTIC' : 'NO_MATCH'
    );

    const result = await pipeline.processCompany({
      company_name: 'ACME S.R.L.',
      city: 'Milano',
      email: 'info@mail.acme.it',
    }, 0);

    expect(result.status).toBe('FOUND_COMPLETE');
    expect(result.website.url).toBe('https://acme.it');
    expect(result.website.discovery_layer).toBe('EMAIL_DOMAIN_SEMANTIC');
    expect(gate.check).toHaveBeenCalledWith('https://acme.it', undefined, 'ACME S.R.L.');
    expect(dedup.search).not.toHaveBeenCalled();
  });

  it('expands SERP subdomain candidates and verifies the root company domain', async () => {
    const { pipeline, gate, dedup } = createPipeline(async (url: string) =>
      url === 'https://acme.it' ? 'VERIFIED_SEMANTIC' : 'NO_MATCH'
    );

    dedup.search.mockResolvedValue({
      results: [{
        title: 'ACME S.R.L. Contatti',
        snippet: 'Contatti ufficiali ACME S.R.L.',
        url: 'https://shop.acme.it/contatti',
        source: 'ddg',
        normalized_url: 'https://shop.acme.it/contatti',
        domain: 'shop.acme.it',
      }],
      linkedin_buffered: 0,
      queries_tried: ['"ACME S.R.L." Milano sito ufficiale'],
      providers_used: ['jina'],
    });

    const result = await pipeline.processCompany({
      company_name: 'ACME S.R.L.',
      city: 'Milano',
    }, 0);

    expect(result.status).toBe('FOUND_COMPLETE');
    expect(result.website.url).toBe('https://acme.it');
    expect(result.website.discovery_layer).toBe('SERP_COMPANY_SEMANTIC');
    expect(gate.check).toHaveBeenCalledWith('https://acme.it', undefined, 'ACME S.R.L.');
  });

  it('skips known company-directory aggregators so noisy SERP hits do not crowd out the official site', async () => {
    const { pipeline, gate, dedup } = createPipeline(async (url: string) =>
      url === 'https://acme.it' ? 'VERIFIED_SEMANTIC' : 'NO_MATCH'
    );

    dedup.search.mockResolvedValue({
      results: [
        {
          title: 'ACME S.R.L. company profile',
          snippet: 'SignalHire profile for ACME S.R.L.',
          url: 'https://www.signalhire.com/companies/acme-srl',
          source: 'ddg',
          normalized_url: 'https://www.signalhire.com/companies/acme-srl',
          domain: 'signalhire.com',
        },
        {
          title: 'ACME S.R.L. - Home',
          snippet: 'Sito ufficiale ACME S.R.L.',
          url: 'https://acme.it',
          source: 'ddg',
          normalized_url: 'https://acme.it',
          domain: 'acme.it',
        },
      ],
      linkedin_buffered: 0,
      queries_tried: ['"ACME S.R.L." Milano sito ufficiale'],
      providers_used: ['jina'],
    });

    const result = await pipeline.processCompany({
      company_name: 'ACME S.R.L.',
      city: 'Milano',
    }, 0);

    expect(result.status).toBe('FOUND_COMPLETE');
    expect(result.website.url).toBe('https://acme.it');
    expect(gate.check).toHaveBeenCalledTimes(1);
    expect(gate.check).toHaveBeenCalledWith('https://acme.it', undefined, 'ACME S.R.L.');
  });
});
