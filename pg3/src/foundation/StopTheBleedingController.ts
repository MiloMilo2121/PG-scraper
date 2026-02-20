import { CostLedger } from './CostLedger';
import { BackpressureValve } from './BackpressureValve';
import { BrowserPool } from './BrowserPool';

export class StopTheBleedingController {
    private ledger: CostLedger;
    private valve: BackpressureValve;
    private pool: BrowserPool;

    private isBleeding = false;
    private bleedingSince = 0;

    constructor(ledger: CostLedger, valve: BackpressureValve, pool: BrowserPool) {
        this.ledger = ledger;
        this.valve = valve;
        this.pool = pool;
    }

    public async evaluateStatus(totalCompaniesProcessed: number): Promise<boolean> {
        // Evaluate to check if we should enter or exit BLEEDING mode
        const health = this.ledger.getHealthSnapshot(300); // 5 min rolling window
        const avgCost = totalCompaniesProcessed > 0 ? await this.ledger.getCostPerCompany(totalCompaniesProcessed) : 0;
        const valveMetrics = this.valve.getMetrics();
        const poolStatus = this.pool.getPoolStatus();

        let shouldBleed = false;
        const reasons: string[] = [];

        // 1. Cost Ceiling
        if (avgCost > 0.04) {
            shouldBleed = true;
            reasons.push(`Avg cost/company €${avgCost.toFixed(4)} > €0.04 limit`);
        }

        // 2. High Error Rate
        if (health.error_rate > 0.25) {
            shouldBleed = true;
            reasons.push(`Global error rate ${Math.round(health.error_rate * 100)}% > 25%`);
        }

        // 3. Complete system saturation (Emergency Concurrency)
        if (valveMetrics.current_concurrency === 1 && valveMetrics.queue_depth > 50) {
            shouldBleed = true;
            reasons.push(`System saturated: Concurrency frozen at 1, queue > 50`);
        }

        // 4. Puppeteer Crash Loop
        if (poolStatus.errors_total > 40) { // arbitrary threshold for now without a time window
            // In a more complex setup, we'd track pool errors per minute.
            // shouldBleed = true; 
            // reasons.push(`Browser pool highly unstable`);
        }

        if (shouldBleed && !this.isBleeding) {
            this.enterBleedingMode(reasons);
        } else if (!shouldBleed && this.isBleeding && Date.now() - this.bleedingSince > 10 * 60 * 1000) {
            // Auto-recover after 10 minutes of being clean
            this.exitBleedingMode();
        }

        return this.isBleeding;
    }

    private enterBleedingMode(reasons: string[]) {
        this.isBleeding = true;
        this.bleedingSince = Date.now();
        console.error(`🚨 [StopTheBleedingController] BLEEDING MODE ACTIVATED 🚨`);
        console.error(`Reasons: ${reasons.join(' | ')}`);

        // Force Backpressure valve down temporarily
        this.valve.setConcurrency(3);
    }

    private exitBleedingMode() {
        this.isBleeding = false;
        this.bleedingSince = 0;
        console.info(`✅ [StopTheBleedingController] Recovered. Exiting BLEEDING Mode.`);
    }

    public get isBleedingModeActive(): boolean {
        return this.isBleeding;
    }
}
