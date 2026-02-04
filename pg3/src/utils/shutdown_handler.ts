
import { BrowserFactory } from '../core/browser/factory_v2';
import { Logger } from './logger';

/**
 * 🛑 GRACEFUL SHUTDOWN HANDLER 🛑
 * Task 37: Handle Signals
 */
export class ShutdownHandler {

    static init() {
        process.on('SIGINT', async () => await this.handleSignal('SIGINT'));
        process.on('SIGTERM', async () => await this.handleSignal('SIGTERM'));

        // Handle Uncaught Errors to log them before crash
        process.on('uncaughtException', (err) => {
            Logger.error(`[Fatal] Uncaught Exception: ${err.message}`, err);
            // process.exit(1); // Optional, or let it crash
        });

        process.on('unhandledRejection', (reason, promise) => {
            Logger.error(`[Fatal] Unhandled Rejection at: ${promise}, reason: ${reason}`);
        });
    }

    private static async handleSignal(signal: string) {
        Logger.info(`[Shutdown] Received ${signal}. Closing resources...`);

        // 1. Close Browsers
        try {
            const factory = BrowserFactory.getInstance();
            await factory.close();
        } catch (e) {
            Logger.error('Error closing browser factory', e);
        }

        // 2. Close DB Connections (if any, e.g. SQLite/Redis)

        Logger.info('[Shutdown] Cleanup complete. Exiting.');
        process.exit(0);
    }
}
