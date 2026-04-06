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

            // Spawn runner as detached process — resolve path relative to this file to work in both
            // dev (ts-node) and compiled (node dist/) environments.
            const isDist = __filename.endsWith('.js');
            const runnerPath = isDist
                ? path.resolve(__dirname, 'scraper/runner.js')
                : path.resolve(__dirname, 'scraper/runner.ts');
            const runnerCmd = isDist ? 'node' : 'npx';
            const runnerArgs = isDist
                ? [runnerPath, `--category=${category}`, `--city=${city}`]
                : ['ts-node', runnerPath, `--category=${category}`, `--city=${city}`];

            const job = spawn(runnerCmd, runnerArgs, {
                cwd: process.cwd(),
                detached: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env }
            });

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

            // Send success only after the OS confirms the process started successfully.
            // If spawn fails (bad path, permissions), the error event fires before spawn.
            job.once('error', (err) => {
                Logger.error(`[${jobId}] Failed to start`, { error: err });
                activeJobs.delete(jobId);
                if (!res.headersSent) {
                    res.status(500).json({ success: false, message: err.message });
                }
            });

            job.once('spawn', () => {
                // Track the job now that we know pid is valid
                if (job.pid) {
                    activeJobs.set(jobId, { pid: job.pid, startedAt: new Date() });
                }
                // Detach from parent so it runs independently
                job.unref();
                res.json({
                    success: true,
                    jobId,
                    message: `Scraper launched: ${category} → ${city}`,
                    pid: job.pid,
                });
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
