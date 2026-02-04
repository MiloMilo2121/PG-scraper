
// import { Queue } from 'bullmq'; // Uncomment when installed
import { config } from '../config';

export class QueueManager {
    private static instance: QueueManager;
    private queues: Map<string, any> = new Map();

    private constructor() { }

    public static getInstance(): QueueManager {
        if (!QueueManager.instance) {
            QueueManager.instance = new QueueManager();
        }
        return QueueManager.instance;
    }

    public getQueue(name: string) {
        if (!this.queues.has(name)) {
            // this.queues.set(name, new Queue(name, { connection: config.redis }));
            console.log(`[QueueManager] Mock Queue '${name}' created.`);
            this.queues.set(name, {
                add: async (jobName: string, data: any) => console.log(`[Queue:${name}] Added job ${jobName}`),
                process: (fn: Function) => console.log(`[Queue:${name}] Process registered`)
            });
        }
        return this.queues.get(name);
    }
}
