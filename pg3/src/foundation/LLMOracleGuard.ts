import { MemoryFirstCache } from './MemoryFirstCache';
import { BackpressureValve } from './BackpressureValve';

export interface GuardConditions {
    candidates_count: number;
    highest_confidence: number;
    has_piva: boolean;
    has_rs: boolean;
    has_address: boolean;
    has_phone: boolean;
    bleeding_mode: boolean;
}

export type GuardResult = 'ORACLE_APPROVED' | 'ORACLE_SKIPPED';

export class LLMOracleGuard {
    private cache: MemoryFirstCache;
    private valve: BackpressureValve;

    constructor(cache: MemoryFirstCache, valve: BackpressureValve) {
        this.cache = cache;
        this.valve = valve;
    }

    public async evaluate(companyId: string, conditions: GuardConditions): Promise<GuardResult> {
        // [C-A] All deterministic layers returned 0 candidates OR all confidence < 0.40.
        if (conditions.candidates_count > 0 && conditions.highest_confidence >= 0.40) {
            return 'ORACLE_SKIPPED';
        }

        // [C-B] Input Minimum Information Check
        let infoPoints = 0;
        if (conditions.has_piva) infoPoints++;
        if (conditions.has_rs) infoPoints++;
        if (conditions.has_address) infoPoints++;
        if (conditions.has_phone) infoPoints++;

        if (infoPoints < 2) {
            return 'ORACLE_SKIPPED'; // Not enough context for LLM to avoid hallucination
        }

        // [C-C] Bleeding Mode
        if (conditions.bleeding_mode) {
            return 'ORACLE_SKIPPED';
        }

        // [C-D] Cooldown (24h)
        const lastQuery = await this.cache.redisOnly<number>('omega:oracle_guard', companyId);
        if (lastQuery && (Date.now() - lastQuery) < 86400 * 1000) {
            return 'ORACLE_SKIPPED';
        }

        // [C-E] SYSTEM SATURATION CHECK
        const metrics = this.valve.getMetrics();
        if (metrics.queue_depth > 50) {
            console.warn(`[LLMOracleGuard] Skipping Oracle for ${companyId} - System saturated (queue: ${metrics.queue_depth}).`);
            return 'ORACLE_SKIPPED';
        }

        // All checks passed. Record intent.
        await this.cache.setRedisOnly('omega:oracle_guard', companyId, Date.now(), 86400);
        return 'ORACLE_APPROVED';
    }
}
