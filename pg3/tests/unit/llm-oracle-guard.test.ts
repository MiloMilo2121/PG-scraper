import { describe, expect, it, vi } from 'vitest';

import { LLMOracleGuard } from '../../src/foundation/LLMOracleGuard';

function createGuard() {
  const cache = {
    redisOnly: vi.fn().mockResolvedValue(null),
    setRedisOnly: vi.fn().mockResolvedValue(undefined),
  };

  const valve = {
    getMetrics: vi.fn().mockReturnValue({ queue_depth: 0 }),
  };

  const guard = new LLMOracleGuard(cache as any, valve as any);
  return { guard, cache, valve };
}

describe('LLMOracleGuard', () => {
  it('skips oracle when there are no real deterministic candidates to adjudicate', async () => {
    const { guard, cache } = createGuard();

    const result = await guard.evaluate('company-1', {
      candidates_count: 0,
      highest_confidence: 0,
      has_piva: true,
      has_rs: true,
      has_address: true,
      has_phone: false,
      bleeding_mode: false,
    });

    expect(result).toBe('ORACLE_SKIPPED');
    expect(cache.setRedisOnly).not.toHaveBeenCalled();
  });

  it('approves oracle when deterministic candidates exist but remain weak', async () => {
    const { guard, cache } = createGuard();

    const result = await guard.evaluate('company-2', {
      candidates_count: 2,
      highest_confidence: 0.31,
      has_piva: false,
      has_rs: true,
      has_address: true,
      has_phone: true,
      bleeding_mode: false,
    });

    expect(result).toBe('ORACLE_APPROVED');
    expect(cache.setRedisOnly).toHaveBeenCalledWith('omega:oracle_guard', 'company-2', expect.any(Number), 86400);
  });

  it('skips oracle when deterministic evidence is already too strong', async () => {
    const { guard, cache } = createGuard();

    const result = await guard.evaluate('company-3', {
      candidates_count: 1,
      highest_confidence: 0.42,
      has_piva: false,
      has_rs: true,
      has_address: true,
      has_phone: false,
      bleeding_mode: false,
    });

    expect(result).toBe('ORACLE_SKIPPED');
    expect(cache.setRedisOnly).not.toHaveBeenCalled();
  });
});
