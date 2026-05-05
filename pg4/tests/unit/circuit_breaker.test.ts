import { describe, it, expect } from 'vitest';
import { CircuitBreaker } from '../../src/runtime/circuit_breaker';

describe('CircuitBreaker', () => {
  it('starts closed and allows calls', () => {
    const cb = new CircuitBreaker();
    expect(cb.allow('crtsh')).toBe(true);
  });

  it('trips OPEN after N consecutive failures', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, windowMs: 10_000, cooldownMs: 5_000 });
    for (let i = 0; i < 3; i++) cb.recordFailure('bing');
    expect(cb.allow('bing')).toBe(false);
  });

  it('does NOT trip when failures are spaced beyond the window', () => {
    let now = 1000;
    const cb = new CircuitBreaker(
      { failureThreshold: 3, windowMs: 1_000, cooldownMs: 5_000 },
      { now: () => now }
    );
    cb.recordFailure('x'); now += 2000;
    cb.recordFailure('x'); now += 2000;
    cb.recordFailure('x');
    // Each recordFailure starts a fresh window because the previous one expired.
    // The threshold of 3 is never reached *within* a single window.
    expect(cb.allow('x')).toBe(true);
  });

  it('a success resets the failure counter', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, windowMs: 10_000, cooldownMs: 5_000 });
    cb.recordFailure('x');
    cb.recordFailure('x');
    cb.recordSuccess('x');
    cb.recordFailure('x');
    expect(cb.allow('x')).toBe(true); // 1 failure since reset, threshold not hit
  });

  it('moves to HALF_OPEN after cooldown and re-opens on next failure', () => {
    let now = 1000;
    const cb = new CircuitBreaker(
      { failureThreshold: 2, windowMs: 10_000, cooldownMs: 5_000 },
      { now: () => now }
    );
    cb.recordFailure('y'); cb.recordFailure('y');
    expect(cb.allow('y')).toBe(false);
    now += 5_500; // past cooldown
    expect(cb.allow('y')).toBe(true); // half_open
    cb.recordFailure('y'); // half_open trial fails → re-open
    expect(cb.allow('y')).toBe(false);
  });

  it('moves HALF_OPEN → CLOSED on a successful trial', () => {
    let now = 1000;
    const cb = new CircuitBreaker(
      { failureThreshold: 2, windowMs: 10_000, cooldownMs: 5_000 },
      { now: () => now }
    );
    cb.recordFailure('z'); cb.recordFailure('z');
    expect(cb.allow('z')).toBe(false);
    now += 5_500;
    expect(cb.allow('z')).toBe(true);
    cb.recordSuccess('z');
    expect(cb.allow('z')).toBe(true);
    cb.recordFailure('z'); // 1 failure in fresh closed state — does not trip
    expect(cb.allow('z')).toBe(true);
  });

  it('per-key configuration overrides the global default', () => {
    const cb = new CircuitBreaker({ failureThreshold: 100, windowMs: 60_000, cooldownMs: 5_000 });
    cb.configure('crtsh', { failureThreshold: 2, windowMs: 60_000, cooldownMs: 5_000 });
    cb.recordFailure('crtsh');
    cb.recordFailure('crtsh');
    expect(cb.allow('crtsh')).toBe(false);
    // global default still applies to other keys
    cb.recordFailure('serper');
    expect(cb.allow('serper')).toBe(true);
  });

  it('snapshot returns a diagnostic view of all keys', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, windowMs: 10_000, cooldownMs: 5_000 });
    cb.recordFailure('a');
    cb.recordFailure('b');
    cb.recordFailure('b');
    const snap = cb.snapshot();
    expect(snap.length).toBe(2);
    expect(snap.find((s) => s.key === 'b')!.consecutiveFailures).toBe(2);
  });
});
