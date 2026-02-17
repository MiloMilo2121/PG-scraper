import express from 'express';
import path from 'path';
import { spawn } from 'child_process';
import { Logger } from './enricher/utils/logger';

const app = express();
const PORT = process.env.PORT || 3000;

// Track active jobs
const activeJobs = new Map<string, { pid: number; startedAt: Date }>();

export async function startServer() {
    // Middleware
    app.use(express.json());

    // Serve Static Landing Page
    const landingPath = path.join(__dirname, 'LANDING');
    app.use(express.static(landingPath));

    // Health Check
    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            uptime: process.uptime(),
            activeJobs: activeJobs.size
        });
    });

    // API: Start Job - REAL INTEGRATION
    app.post('/api/start-job', (req, res) => {
        try {
            const { target } = req.body;

            if (!target) {
                return res.status(400).json({ success: false, message: 'Missing target configuration' });
            }

            const { niche_raw, location_raw } = target;

            if (!niche_raw || !location_raw) {
                return res.status(400).json({ success: false, message: 'Both niche and location are required' });
            }

            // Generate Job ID
            const jobId = `JOB_${Date.now()}`;

            // Build runner arguments
            // Take first value from comma-separated list
            const category = niche_raw.split(',')[0].trim();
            const city = location_raw.split(',')[0].trim();

            Logger.info('🚀 Launching Scraper Job', {
                jobId,
                category,
                city,
                allNiches: niche_raw,
                allLocations: location_raw
            });

            // Determine execution mode
            const isProduction = process.env.NODE_ENV === 'production';

            let command = 'npx';
            let args: string[] = [];

            if (isProduction) {
                // Production: Run compiled JS
                command = 'node';
                const runnerPath = path.join(__dirname, 'scraper/runner.js'); // dist/src/server.js -> dist/src/scraper/runner.js
                args = [runnerPath, `--category=${category}`, `--city=${city}`];
                Logger.info('   🔧 Mode: PRODUCTION (node dist/...)');
            } else {
                // Development: Run TS via ts-node
                command = 'npx';
                const runnerPath = path.join(process.cwd(), 'src/scraper/runner.ts');
                args = ['ts-node', runnerPath, `--category=${category}`, `--city=${city}`];
                Logger.info('   🔧 Mode: DEVELOPMENT (ts-node)');
            }

            const job = spawn(command, args, {
                cwd: process.cwd(),
                detached: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env }
            });

            // Track the job
            if (job.pid) {
                activeJobs.set(jobId, { pid: job.pid, startedAt: new Date() });
            }

            // Log output for debugging
            job.stdout?.on('data', (data) => {
                Logger.info(`[${jobId}] ${data.toString().trim()}`);
            });

            job.stderr?.on('data', (data) => {
                Logger.warn(`[${jobId}] ${data.toString().trim()}`);
            });

            job.on('close', (code) => {
                Logger.info(`[${jobId}] Process exited with code ${code}`);
                activeJobs.delete(jobId);
            });

            job.on('error', (err) => {
                Logger.error(`[${jobId}] Failed to start`, { error: err });
                activeJobs.delete(jobId);
            });

            // Detach from parent so it runs independently
            job.unref();

            res.json({
                success: true,
                jobId,
                message: `Scraper launched: ${category} → ${city}`,
                pid: job.pid
            });

        } catch (error) {
            Logger.error('Failed to start job', { error: error as Error });
            res.status(500).json({ success: false, message: 'Internal Server Error' });
        }
    });

    // API: Get Job Status
    app.get('/api/jobs', (req, res) => {
        const jobs = Array.from(activeJobs.entries()).map(([id, info]) => ({
            jobId: id,
            pid: info.pid,
            startedAt: info.startedAt,
            runningFor: `${Math.round((Date.now() - info.startedAt.getTime()) / 1000)}s`
        }));
        res.json({ jobs, count: jobs.length });
    });

    // Start Listener
    app.listen(PORT, () => {
        Logger.info(`🚀 ANTIGRAVITY Dashboard running at http://localhost:${PORT}`);
        Logger.info(`📂 Serving UI from: ${landingPath}`);
    });
}
