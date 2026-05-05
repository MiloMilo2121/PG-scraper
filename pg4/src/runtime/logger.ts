import pino from 'pino';

const level = (process.env.LOG_LEVEL || 'info').toLowerCase();
const format = (process.env.LOG_FORMAT || (process.env.NODE_ENV === 'production' ? 'json' : 'pretty')).toLowerCase();

export const logger = pino(
  {
    level,
    base: { pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  format === 'pretty'
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname',
          translateTime: 'HH:MM:ss.l',
        },
      })
    : pino.destination(1)
);

/** Create a child logger with a stable bound context (e.g. `{ stage: 'rdap' }`). */
export function child(bindings: Record<string, unknown>): pino.Logger {
  return logger.child(bindings);
}
