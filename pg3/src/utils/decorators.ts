import { Logger } from '../enricher/utils/logger';
import { TorError } from './errors';

export interface RetryOptions {
    attempts?: number;
    delay?: number;
    backoff?: 'fixed' | 'exponential';
    factor?: number;
    retryCondition?: (error: any) => boolean;
}

/**
 * 🔁 RETRY DECORATOR
 * Wraps a class method with retry logic.
 * Non-retryable errors (TorError with canRetry=false) are thrown immediately.
 *
 * Usage:
 * @Retry({ attempts: 3, delay: 1000, backoff: 'exponential' })
 * async myMethod() { ... }
 */
export function Retry(options: RetryOptions = {}) {
    const attempts = options.attempts || 3;
    const delay = options.delay || 1000;
    const backoff = options.backoff || 'fixed';
    const factor = options.factor || 2;

    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;

        descriptor.value = async function (...args: any[]) {
            let lastError: any;

            for (let i = 0; i < attempts; i++) {
                try {
                    return await originalMethod.apply(this, args);
                } catch (error: any) {
                    lastError = error;

                    // Fail-fast: non-retryable TorError (e.g. ControlPort unreachable)
                    if (error instanceof TorError && !error.canRetry) {
                        Logger.warn(`[Retry] Method ${propertyKey} failed with non-retryable TorError. Skipping remaining retries.`);
                        throw error;
                    }

                    // Check if we should retry based on custom condition
                    if (options.retryCondition && !options.retryCondition(error)) {
                        throw error;
                    }

                    const isLastAttempt = i === attempts - 1;
                    if (isLastAttempt) break;

                    const waitTime = backoff === 'exponential'
                        ? delay * Math.pow(factor, i)
                        : delay;

                    Logger.warn(`[Retry] Method ${propertyKey} failed (Attempt ${i + 1}/${attempts}). Retrying in ${waitTime}ms...`, { error: error.message });

                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }

            Logger.error(`[Retry] Method ${propertyKey} failed after ${attempts} attempts.`, { error: lastError });
            throw lastError;
        };

        return descriptor;
    };
}
