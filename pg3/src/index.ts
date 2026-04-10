import { Logger } from './shared-runtime/logging/Logger';
import { initializeRuntimeEnvironment } from './shared-runtime/config/runtime_bootstrap';
import { initializeRuntimeConfig } from './shared-runtime/config/runtime_config';

const VALID_COMMANDS = new Set(['worker', 'scheduler', 'server']);

function printUsage(): void {
  Logger.info('Usage:');
  Logger.info('  node dist/src/index.js worker');
  Logger.info('  node dist/src/index.js scheduler <path/to/file.csv>');
  Logger.info('  node dist/src/index.js server');
}

async function main(): Promise<void> {
  initializeRuntimeEnvironment();
  initializeRuntimeConfig();
  const command = process.argv[2];

  if (!command || !VALID_COMMANDS.has(command)) {
    Logger.error(`Invalid command: ${command || '(missing)'}`);
    printUsage();
    process.exit(1);
  }

  if (command === 'worker') {
    Logger.info('🚀 ANTIGRAVITY starting in WORKER mode');
    const { startWorker } = await import('./enricher/worker');
    await startWorker();
    return;
  }

  if (command === 'server') {
    Logger.info('🚀 ANTIGRAVITY starting in SERVER mode');
    const { startServer } = await import('./server');
    await startServer();
    return;
  }

  const csvPath = process.argv[3] || process.env.SCHEDULER_INPUT_FILE;
  if (!csvPath) {
    Logger.error('Missing CSV path for scheduler mode');
    printUsage();
    process.exit(1);
  }

  Logger.info('🚀 ANTIGRAVITY starting in SCHEDULER mode');
  const { runScheduler } = await import('./enricher/scheduler');
  const summary = await runScheduler(csvPath);

  Logger.info('Scheduler summary', {
    loaded: summary.loaded,
    enqueued: summary.enqueued,
    skipped: summary.skipped,
    duration_ms: summary.durationMs,
  });
}

main().catch((err) => {
  Logger.error('Fatal error', { error: err as Error });
  process.exit(1);
});
