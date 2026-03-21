/**
 * 🔗 HANDOVER PROTOCOL
 * Bridge between PG1 (Shadow Hunter) and PG3 (Golden Refinery)
 * 
 * Workflow:
 * 1. PG1 finishes scraping a city → raw_targets.csv
 * 2. This script moves the CSV to PG3/input/
 * 3. Triggers the canonical PG3 scheduler entrypoint
 * 
 * Usage:
 * npx ts-node handover.ts --source /path/to/raw_targets.csv
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

// Configuration
const DEFAULT_PG3_ROOT = path.resolve(process.cwd(), '../pg3');

export interface HandoverConfig {
    sourcePath: string;
    cityName: string;
    priority?: number;
}

function sanitizeCitySegment(cityName: string): string {
    return cityName
        .trim()
        .replace(/[^\w.-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        || 'unknown';
}

export async function closeHandoverResources(): Promise<void> {
    return;
}

function resolvePg3Root(): string {
    const explicit = process.env.PG3_ROOT ? path.resolve(process.cwd(), process.env.PG3_ROOT) : null;
    const candidates = [explicit, DEFAULT_PG3_ROOT].filter(Boolean) as string[];

    for (const candidate of candidates) {
        if (fs.existsSync(path.join(candidate, 'package.json'))) {
            return candidate;
        }
    }

    throw new Error(`PG3 root not found. Checked: ${candidates.join(', ')}`);
}

function resolvePg3InputDir(pg3Root: string): string {
    const configured = process.env.PG3_INPUT_DIR
        ? path.resolve(pg3Root, process.env.PG3_INPUT_DIR)
        : path.join(pg3Root, 'input');
    return configured;
}

function resolveSchedulerLaunch(pg3Root: string): { command: string; args: string[]; cwd: string } {
    const builtEntry = path.join(pg3Root, 'dist', 'src', 'index.js');
    if (fs.existsSync(builtEntry)) {
        return {
            command: process.execPath,
            args: [builtEntry, 'scheduler'],
            cwd: pg3Root,
        };
    }

    const sourceEntry = path.join(pg3Root, 'src', 'index.ts');
    if (fs.existsSync(sourceEntry)) {
        return {
            command: process.execPath,
            args: ['-r', 'ts-node/register', sourceEntry, 'scheduler'],
            cwd: pg3Root,
        };
    }

    throw new Error('PG3 scheduler entrypoint not found in build or source tree');
}

async function triggerPg3Scheduler(csvPath: string): Promise<void> {
    const pg3Root = resolvePg3Root();
    const launch = resolveSchedulerLaunch(pg3Root);

    await new Promise<void>((resolve, reject) => {
        const child = spawn(launch.command, [...launch.args, csvPath], {
            cwd: launch.cwd,
            env: { ...process.env },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stderr = '';

        child.stdout?.on('data', (chunk) => {
            process.stdout.write(chunk);
        });

        child.stderr?.on('data', (chunk) => {
            const text = chunk.toString();
            stderr += text;
            process.stderr.write(text);
        });

        child.on('error', (error) => {
            reject(error);
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(`PG3 scheduler exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
        });
    });
}

/**
 * Execute handover from PG1 to PG3
 */
export async function executeHandover(config: HandoverConfig): Promise<void> {
    const { sourcePath, cityName, priority = 1 } = config;
    const pg3Root = resolvePg3Root();
    const pg3InputDir = resolvePg3InputDir(pg3Root);

    console.log(`🔗 Handover Protocol: Starting transfer for ${cityName}`);

    // Validate source file exists
    if (!fs.existsSync(sourcePath)) {
        throw new Error(`Source file not found: ${sourcePath}`);
    }

    // Ensure PG3 input directory exists
    if (!fs.existsSync(pg3InputDir)) {
        fs.mkdirSync(pg3InputDir, { recursive: true });
    }

    // Generate timestamped filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeCityName = sanitizeCitySegment(cityName);
    const destFilename = `${safeCityName}_${timestamp}.csv`;
    const destPath = path.join(pg3InputDir, destFilename);

    // Copy file to PG3 input
    fs.copyFileSync(sourcePath, destPath);
    console.log(`📁 Copied: ${sourcePath} → ${destPath}`);

    // Read and parse CSV to get company count
    const csvContent = fs.readFileSync(destPath, 'utf-8');
    const lines = csvContent.split('\n').filter(line => line.trim());
    const companyCount = Math.max(0, lines.length - 1); // Exclude header

    console.log(`📊 Found ${companyCount} companies to enrich`);

    console.log(`🚀 Triggering PG3 scheduler for ${companyCount} companies (priority hint ${priority} is ignored; PG3 owns queue policy).`);
    await triggerPg3Scheduler(destPath);
    console.log(`🔗 Handover complete! PG3 scheduler accepted ${companyCount} companies.`);

    // Optional: Archive source file
    const archiveDir = path.join(path.dirname(sourcePath), 'archive');
    if (!fs.existsSync(archiveDir)) {
        fs.mkdirSync(archiveDir, { recursive: true });
    }
    const archivePath = path.join(archiveDir, path.basename(sourcePath));
    fs.renameSync(sourcePath, archivePath);
    console.log(`📦 Archived source: ${archivePath}`);
}

/**
 * Watch for new files in PG1 output directory
 */
export async function watchAndHandover(watchDir: string): Promise<void> {
    console.log(`👁️ Watching for new CSV files in: ${watchDir}`);

    const processed = new Set<string>();
    const inFlight = new Set<string>();
    let scanRunning = false;

    const checkForNewFiles = async () => {
        if (scanRunning) {
            return;
        }
        scanRunning = true;

        const files = fs.readdirSync(watchDir);

        try {
            for (const file of files) {
                if (!file.endsWith('.csv') || processed.has(file) || inFlight.has(file)) {
                    continue;
                }

                const filePath = path.join(watchDir, file);
                const cityMatch = file.match(/^(.+?)_/);
                const cityName = cityMatch ? cityMatch[1] : 'unknown';

                inFlight.add(file);
                try {
                    await executeHandover({
                        sourcePath: filePath,
                        cityName,
                    });
                    processed.add(file);
                } catch (error) {
                    console.error(`❌ Handover failed for ${file}:`, error);
                } finally {
                    inFlight.delete(file);
                }
            }
        } finally {
            scanRunning = false;
        }
    };

    // Initial check
    await checkForNewFiles();

    // Watch for changes
    fs.watch(watchDir, async (eventType, filename) => {
        if (eventType === 'rename' && filename?.endsWith('.csv')) {
            await checkForNewFiles();
        }
    });
}

// CLI execution
if (require.main === module) {
    const args = process.argv.slice(2);
    const sourceIndex = args.indexOf('--source');
    const watchIndex = args.indexOf('--watch');

    if (sourceIndex !== -1 && args[sourceIndex + 1]) {
        const sourcePath = args[sourceIndex + 1];
        const cityName = path.basename(sourcePath, '.csv');

        executeHandover({ sourcePath, cityName })
            .then(async () => {
                await closeHandoverResources();
                process.exit(0);
            })
            .catch((error) => {
                console.error(error);
                closeHandoverResources()
                    .finally(() => process.exit(1));
            });
    } else if (watchIndex !== -1 && args[watchIndex + 1]) {
        process.once('SIGINT', () => {
            closeHandoverResources().finally(() => process.exit(0));
        });
        process.once('SIGTERM', () => {
            closeHandoverResources().finally(() => process.exit(0));
        });
        watchAndHandover(args[watchIndex + 1]).catch((error) => {
            console.error(error);
            closeHandoverResources().finally(() => process.exit(1));
        });
    } else {
        console.log(`
🔗 HANDOVER PROTOCOL

Usage:
  npx ts-node handover.ts --source /path/to/raw_targets.csv
  npx ts-node handover.ts --watch /path/to/pg1/output/

Options:
  --source <path>   Process a single CSV file
  --watch <dir>     Watch directory for new CSV files
        `);
    }
}
