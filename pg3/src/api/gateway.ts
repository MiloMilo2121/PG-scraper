
import * as http from 'http';
import { DatabaseService } from '../core/db/database';
import { QueueManager } from '../core/queue_manager';

const PORT = process.env.PORT || 3000;

export function startApiGateway() {
    const server = http.createServer(async (req, res) => {
        if (req.url === '/health' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
        } else if (req.url === '/submit' && req.method === 'POST') {
            // Handle submission to queue
            const queue = QueueManager.getInstance().getQueue('discovery');
            // queue.add('job', body...);
            res.writeHead(202, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'queued' }));
        } else {
            res.writeHead(404);
            res.end('Not Found');
        }
    });

    server.listen(PORT, () => {
        console.log(`[API Gateway] Listening on port ${PORT}`);
    });
}
