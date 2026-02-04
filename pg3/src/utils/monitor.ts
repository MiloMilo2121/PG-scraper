
import * as os from 'os';

export class ResourceMonitor {
    public static getUsage() {
        return {
            memory: process.memoryUsage(),
            uptime: process.uptime(),
            load: os.loadavg(),
            cpus: os.cpus().length
        };
    }

    public static logUsage() {
        const usage = this.getUsage();
        const heapUsed = Math.round(usage.memory.heapUsed / 1024 / 1024);
        // console.log(`[Monitor] Heap: ${heapUsed}MB | Load: ${usage.load[0].toFixed(2)}`);
    }
}
