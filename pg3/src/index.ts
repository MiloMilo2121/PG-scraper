/**
 * 🚀 ANTIGRAVITY ENRICHER - Main Entry Point
 * 
 * This is the primary entry point for the enrichment service.
 * It can run in two modes:
 * 1. Worker Mode (default): Processes jobs from the BullMQ queue
 * 2. Scheduler Mode: Loads a CSV and schedules jobs to the queue
 * 
 * Usage:
 *   npm start                    # Starts the worker
 *   npm run scheduler <file.csv> # Schedules jobs from CSV
 */

import { Logger } from './enricher/utils/logger';

async function main() {
    const mode = process.argv[2] || 'worker';

    Logger.info(`🚀 ANTIGRAVITY Starting in ${mode.toUpperCase()} mode...`);

    if (mode === 'scheduler') {
        const csvPath = process.argv[3];
        if (!csvPath) {
            Logger.error('Usage: npm run scheduler <path/to/file.csv>');
            process.exit(1);
        }
        // Dynamically import scheduler to avoid loading worker dependencies
        const { runScheduler } = await import('./enricher/scheduler');
        await runScheduler(csvPath);
    } else {
        // Default: Worker mode
        const { startWorker } = await import('./enricher/worker');
        await startWorker();
    }
}

main().catch(err => {
    Logger.error('Fatal error:', { error: err });
    process.exit(1);
});
