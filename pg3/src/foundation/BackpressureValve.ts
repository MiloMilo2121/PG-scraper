import { CostLedger } from './CostLedger';

export class BackpressureOverflowError extends Error {
    constructor() {
        super('BackpressureOverflowError: Queue depth exceeded maximum capacity.');
        this.name = 'BackpressureOverflowError';
    }
}

interface QueuedTask<T> {
    fn: () => Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: any) => void;
    priority: number;
    enqueuedAt: number;
}

export interface ValveMetrics {
    current_concurrency: number;
    max_concurrency: number;
    queue_depth: number;
    avg_response_ms: number;
    error_rate_5m: number;
    adjustments_made: number;
}

export class BackpressureValve {
    private currentConcurrency: number;
    private maxConcurrency: number;
    private minConcurrency: number;

    private targetConcurrency: number; // AIMD controlled
    private activeRequests = 0;

    // Priority queues: 0 (highest) to 3 (lowest)
    private queues: QueuedTask<any>[][] = [[], [], [], []];

    private ledger: CostLedger;
    private healthPollIntervalMs: number;
    private pollTimer: NodeJS.Timeout | null = null;

    private isPaused = false;
    private adjustmentsMade = 0;

    constructor(options: {
        initialConcurrency?: number;
        minConcurrency?: number;
        maxConcurrency?: number;
        healthPollInterval?: number;
        ledger: CostLedger;
    }) {
        this.ledger = options.ledger;
        this.minConcurrency = options.minConcurrency || 1;
        this.maxConcurrency = options.maxConcurrency || 15;
        this.targetConcurrency = options.initialConcurrency || 3;
        this.currentConcurrency = this.targetConcurrency;
        this.healthPollIntervalMs = options.healthPollInterval || 2000;

        this.startPolling();
    }

    private startPolling() {
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = setInterval(() => this.adjustConcurrency(), this.healthPollIntervalMs);
    }

    public cleanup() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    private adjustConcurrency() {
        if (this.isPaused) return;

        const health = this.ledger.getHealthSnapshot(30);

        // Safety net: Redis down or MemoryFirstCache issues? 
        // We simulate a strict cap if things are really broken, but we don't strictly have Redis state here.
        // We just use error rates.

        if (health.error_rate > 0.30) {
            // Emergency Mode
            if (this.targetConcurrency !== 1) {
                this.targetConcurrency = 1;
                this.adjustmentsMade++;
                console.warn('[BackpressureValve] EMERGENCY MODE ACTIVATED: error_rate > 30%. Concurrency locked to 1.');
            }
        } else if (health.error_rate > 0.15 || health.avg_duration_ms > 8000) {
            // Multiplicative Decrease
            const newTarget = Math.floor(this.targetConcurrency / 2);
            this.targetConcurrency = Math.max(this.minConcurrency, newTarget);
            this.adjustmentsMade++;
            console.warn(`[BackpressureValve] THROTTLING: error_rate=${(health.error_rate * 100).toFixed(1)}%, avg_ms=${health.avg_duration_ms.toFixed(0)}. Concurrency halved to ${this.targetConcurrency}.`);
        } else if (health.error_rate < 0.05 && health.avg_duration_ms < 3000) {
            // Additive Increase
            if (this.targetConcurrency < this.maxConcurrency) {
                this.targetConcurrency++;
                this.adjustmentsMade++;
            }
        }

        this.currentConcurrency = this.targetConcurrency;
        this.drain();
    }

    private getQueueDepth(): number {
        return this.queues.reduce((acc, q) => acc + q.length, 0);
    }

    public async execute<T>(fn: () => Promise<T>, priority: number = 1): Promise<T> {
        if (this.getQueueDepth() > 100) {
            throw new BackpressureOverflowError();
        }

        const safePriority = Math.max(0, Math.min(3, Math.floor(priority)));

        return new Promise<T>((resolve, reject) => {
            this.queues[safePriority].push({
                fn,
                resolve,
                reject,
                priority: safePriority,
                enqueuedAt: Date.now()
            });

            this.drain();
        });
    }

    private drain() {
        if (this.isPaused) return;

        while (this.activeRequests < this.currentConcurrency) {
            const task = this.dequeueHighestPriority();
            if (!task) break; // Queues empty

            this.activeRequests++;

            task.fn()
                .then(task.resolve)
                .catch(task.reject)
                .finally(() => {
                    this.activeRequests--;
                    this.drain(); // Try to start next task
                });
        }
    }

    private dequeueHighestPriority(): QueuedTask<any> | undefined {
        for (let i = 0; i < 4; i++) {
            if (this.queues[i].length > 0) {
                return this.queues[i].shift();
            }
        }
        return undefined;
    }

    public setConcurrency(n: number) {
        this.targetConcurrency = Math.max(this.minConcurrency, Math.min(this.maxConcurrency, n));
        this.currentConcurrency = this.targetConcurrency;
        this.drain();
    }

    public pause() {
        this.isPaused = true;
    }

    public resume() {
        this.isPaused = false;
        this.drain();
    }

    public getMetrics(): ValveMetrics {
        const health = this.ledger.getHealthSnapshot(300); // 5m
        return {
            current_concurrency: this.currentConcurrency,
            max_concurrency: this.maxConcurrency,
            queue_depth: this.getQueueDepth(),
            avg_response_ms: health.avg_duration_ms,
            error_rate_5m: health.error_rate,
            adjustments_made: this.adjustmentsMade
        };
    }
}
