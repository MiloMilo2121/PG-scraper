import winston from 'winston';
import 'winston-daily-rotate-file';
import { OutputResult } from '../../types';

export class Logger {
    private logger: winston.Logger;

    constructor() {
        const fileTransport = new winston.transports.DailyRotateFile({
            filename: 'logs/adr-it-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            zippedArchive: true,
            maxSize: '20m',
            maxFiles: '14d'
        });

        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            transports: [
                fileTransport,
                new winston.transports.Console({ format: winston.format.simple() })
            ]
        });
    }

    log(level: string, message: string, meta?: any) {
        this.logger.log(level, message, meta);
    }
}

export const logger = new Logger();

export class Metrics {
    stats = {
        total: 0,
        ok: 0,
        no_domain: 0,
        error: 0,
        total_latency: 0
    };

    record(result: OutputResult, latencyMs: number) {
        this.stats.total++;
        if (result.status === 'OK') this.stats.ok++;
        if (result.status === 'NO_DOMAIN_FOUND') this.stats.no_domain++;
        if (result.status === 'ERROR') this.stats.error++;
        this.stats.total_latency += latencyMs;
    }

    getSummary() {
        return {
            ...this.stats,
            avg_latency: this.stats.total > 0 ? Math.round(this.stats.total_latency / this.stats.total) : 0
        };
    }
}

export const metrics = new Metrics();
