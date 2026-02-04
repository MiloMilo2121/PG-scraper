
import { Logger } from './logger';

export class AppError extends Error {
    constructor(public message: string, public code: string, public isOperational: boolean = true) {
        super(message);
        Object.setPrototypeOf(this, AppError.prototype);
    }
}

export class ErrorHandler {
    public static handleError(error: Error) {
        if (error instanceof AppError && error.isOperational) {
            Logger.warn(`[Operational Error] ${error.code}: ${error.message}`);
        } else {
            Logger.error('[System Error] Unexpected crash:', error);
            // Notify admin / Sentry
        }
    }

    public static async handleFatalError(error: Error) {
        Logger.error('🔥 FATAL ERROR 🔥', error);
        process.exit(1);
    }
}

process.on('uncaughtException', (error) => ErrorHandler.handleFatalError(error));
process.on('unhandledRejection', (reason) => ErrorHandler.handleFatalError(reason as Error));
