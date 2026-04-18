/**
 * 🏥 HEALTH CHECK API
 * Task 9: Lightweight HTTP server for monitoring
 * 
 * Endpoints:
 * - GET /health - Overall system health
 * - GET /stats - Processing statistics
 */

import * as http from 'http';
import { Logger } from './utils/logger';
import { getQueueHealth } from './queue';
import {
    getStats as getDbStats,
    initializeDatabase,
    getOutcomeBreakdown,
    getEnrichedFieldCoverage,
    getTopReasonCodes,
} from './db';
import { config } from './config';

const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    try {
        if (req.url === '/health') {
            const queueHealth = await getQueueHealth();
            const isHealthy = queueHealth.redis;

            res.statusCode = isHealthy ? 200 : 503;
            res.end(JSON.stringify({
                status: isHealthy ? 'healthy' : 'unhealthy',
                timestamp: new Date().toISOString(),
                redis: queueHealth.redis ? 'connected' : 'disconnected',
                queue: queueHealth.enrichmentQueue,
                error: queueHealth.error || null,
            }));
        } else if (req.url === '/stats') {
            const dbStats = getDbStats();
            const queueHealth = await getQueueHealth();

            // Analytics queries are best-effort – don't crash /stats if DB isn't initialised
            let outcomeBreakdown: Record<string, number> = {};
            let fieldCoverage: ReturnType<typeof getEnrichedFieldCoverage> | null = null;
            let topReasonCodes: Array<{ reason_code: string; count: number }> = [];
            try { outcomeBreakdown = getOutcomeBreakdown(); } catch { /* ok */ }
            try { fieldCoverage = getEnrichedFieldCoverage(); } catch { /* ok */ }
            try { topReasonCodes = getTopReasonCodes(undefined, 10); } catch { /* ok */ }

            res.statusCode = 200;
            res.end(JSON.stringify({
                database: {
                    ...dbStats,
                    outcome_breakdown: outcomeBreakdown,
                    field_coverage: fieldCoverage ?? null,
                    top_reason_codes: topReasonCodes,
                },
                queue: queueHealth.enrichmentQueue,
                timestamp: new Date().toISOString(),
            }));
        } else {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Not Found' }));
        }
    } catch (error) {
        Logger.error('Health check error', { error: error as Error });
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
});

export function startHealthServer(): void {
    initializeDatabase();
    const port = config.health.port;
    server.listen(port, () => {
        Logger.info(`🏥 Health check API running on http://localhost:${port}/health`);
    });
}

// Auto-start if run directly
if (require.main === module) {
    startHealthServer();
}
