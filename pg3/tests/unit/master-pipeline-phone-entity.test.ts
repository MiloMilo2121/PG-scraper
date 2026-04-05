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

function createPipeline(options?: {
  gateStatus?: string;
  bleedingMode?: boolean;
}) {
  const registry = {
    find: vi.fn().mockResolvedValue(null),
  };

  const gate = {
    check: vi.fn().mockResolvedValue(options?.gateStatus ?? 'NO_MATCH'),
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
    evaluateStatus: vi.fn().mockResolvedValue(options?.bleedingMode ?? false),
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

describe('MasterPipeline phone/entity lane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.harvestByPhone.mockResolvedValue(null);
    mocks.hyperBlast.mockResolvedValue(null);
    mocks.rdapCheckDomainOwnership.mockResolvedValue(0);
    mocks.fattHarvest.mockResolvedValue(null);
  });

  it('verifies official websites extracted from an exact PG entity before SERP discovery', async () => {
    mocks.harvestByPhone.mockResolvedValue({
      pgUrl: 'https://www.paginegialle.it/acme-srl',
      officialWebsite: 'https://acme.it/contatti',
      vat: '12345678901',
      matchedBy: 'phone',
    });

    const { pipeline, gate, dedup } = createPipeline({ gateStatus: 'VERIFIED' });
    const result = await pipeline.processCompany({
      company_name: 'ACME S.R.L.',
      city: 'Milano',
      pg_url: 'https://www.paginegialle.it/acme-srl',
    }, 0);

    expect(result.status).toBe('FOUND_COMPLETE');
    expect(result.reason_code).toBe('FOUND_COMPLETE');
    expect(result.website.url).toBe('https://acme.it/contatti');
    expect(result.website.discovery_layer).toBe('PG_PHONE_PIVA_MATCH');
    expect(result.meta.layers_attempted).toContain('STAGE_1_6_PHONE_ENTITY');
    expect(gate.check).toHaveBeenCalledWith('https://acme.it/contatti', '12345678901', 'ACME S.R.L.');
    expect(dedup.search).not.toHaveBeenCalled();
    expect(mocks.harvestByPhone).toHaveBeenCalledWith(expect.objectContaining({
      company_name: 'ACME S.R.L.',
      pg_url: 'https://www.paginegialle.it/acme-srl',
    }));
  });

  it('returns a dedicated reason when the exact phone/entity match only yields a directory page', async () => {
    mocks.harvestByPhone.mockResolvedValue({
      pgUrl: 'https://www.paginegialle.it/acme-srl',
      matchedBy: 'phone',
    });

    const { pipeline } = createPipeline();
    const result = await pipeline.processCompany({
      company_name: 'ACME S.R.L.',
      city: 'Milano',
      phone: '02 123456',
    }, 0);

    expect(result.status).toBe('NOT_FOUND');
    expect(result.reason_code).toBe('PHONE_ENTITY_DIRECTORY_ONLY');
  });

  it('returns enrichment-only status when PG yields a confirmed email but no website', async () => {
    mocks.harvestByPhone.mockResolvedValue({
      pgUrl: 'https://www.paginegialle.it/acme-srl',
      email: 'info@acme.it',
      matchedBy: 'phone',
    });

    const { pipeline } = createPipeline();
    const result = await pipeline.processCompany({
      company_name: 'ACME S.R.L.',
      city: 'Milano',
      phone: '02 123456',
    }, 0);

    expect(result.status).toBe('ENRICHMENT_ONLY_NO_WEBSITE');
    expect(result.reason_code).toBe('ENRICHMENT_ONLY_NO_WEBSITE');
    expect(result.email).toBe('info@acme.it');
    expect(result.website).toBeUndefined();
    expect(result.meta.stage_outcomes.contacts.reason_code).toBe('CONTACTS_CONFIRMED_PG_EMAIL');
  });

  it('returns a dedicated reason when the exact phone/entity website cannot be verified strictly', async () => {
    mocks.harvestByPhone.mockResolvedValue({
      pgUrl: 'https://www.paginegialle.it/acme-srl',
      officialWebsite: 'https://acme.it',
      matchedBy: 'phone',
    });

    const { pipeline, gate } = createPipeline({ gateStatus: 'NO_MATCH' });
    const result = await pipeline.processCompany({
      company_name: 'ACME S.R.L.',
      city: 'Milano',
      phone: '02 123456',
    }, 0);

    expect(result.status).toBe('FOUND_COMPLETE');
    expect(result.reason_code).toBe('FOUND_COMPLETE');
    expect(result.website.url).toMatch(/^https:\/\/acme\.it\/?$/);
    expect(result.website.discovery_layer).toBe('PG_PHONE_SOURCE_TRUST');
    expect(gate.check).toHaveBeenCalledWith('https://acme.it', undefined, 'ACME S.R.L.');
  });
});
