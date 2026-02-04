import { Logger } from './logger';

export function recordCost(type: string, amount: number) {
    // Stub implementation
    Logger.info(`[Cost] Recorded ${amount} for ${type}`);
}
