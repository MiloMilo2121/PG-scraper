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
import { getStats as getDbStats } from './db';

const PORT = parseInt(process.env.HEALTH_PORT || '3000');

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
            }));
        } else if (req.url === '/stats') {
            const dbStats = getDbStats();
            const queueHealth = await getQueueHealth();

            res.statusCode = 200;
            res.end(JSON.stringify({
                database: dbStats,
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
    server.listen(PORT, () => {
        Logger.info(`🏥 Health check API running on http://localhost:${PORT}/health`);
    });
}

// Auto-start if run directly
if (require.main === module) {
    startHealthServer();
}
