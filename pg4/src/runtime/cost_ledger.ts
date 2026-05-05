import { logger } from './logger';

interface LedgerEntry {
  provider: string;
  family: string;
  cost_eur: number;
  ts: number;
  success: boolean;
}

/**
 * In-memory cost ledger. Persists nothing in v1; callers can serialize a
 * snapshot at run end if needed. Designed to swap for a file-backed
 * implementation later without touching call sites.
 */
export class CostLedger {
  private entries: LedgerEntry[] = [];

  record(provider: string, family: string, costEur: number, success: boolean): void {
    this.entries.push({ provider, family, cost_eur: costEur, ts: Date.now(), success });
  }

  getTotal(): number {
    let sum = 0;
    for (const e of this.entries) sum += e.cost_eur;
    return sum;
  }

  getByProvider(): Record<string, { calls: number; cost_eur: number; success_rate: number }> {
    const acc: Record<string, { calls: number; cost_eur: number; ok: number }> = {};
    for (const e of this.entries) {
      const a = (acc[e.provider] ??= { calls: 0, cost_eur: 0, ok: 0 });
      a.calls += 1;
      a.cost_eur += e.cost_eur;
      if (e.success) a.ok += 1;
    }
    const out: Record<string, { calls: number; cost_eur: number; success_rate: number }> = {};
    for (const [k, v] of Object.entries(acc)) {
      out[k] = { calls: v.calls, cost_eur: v.cost_eur, success_rate: v.calls === 0 ? 0 : v.ok / v.calls };
    }
    return out;
  }

  getSummary(): { total_calls: number; total_cost_eur: number; success_rate: number } {
    if (this.entries.length === 0) return { total_calls: 0, total_cost_eur: 0, success_rate: 0 };
    let cost = 0;
    let ok = 0;
    for (const e of this.entries) {
      cost += e.cost_eur;
      if (e.success) ok += 1;
    }
    return {
      total_calls: this.entries.length,
      total_cost_eur: cost,
      success_rate: ok / this.entries.length,
    };
  }

  logSummary(): void {
    const s = this.getSummary();
    logger.info(
      { total_calls: s.total_calls, total_cost_eur: s.total_cost_eur, success_rate: s.success_rate },
      '[CostLedger] run summary'
    );
  }
}
