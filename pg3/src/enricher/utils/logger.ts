
/**
 * 📝 STRUCTURED LOGGER 📝
 * Task 38: JSON Logging support
 */
export class Logger {
    private static isDev = process.env.NODE_ENV !== 'production';

    static info(msg: string, ...args: any[]) {
        this.log('INFO', msg, args);
    }

    static warn(msg: string, ...args: any[]) {
        this.log('WARN', msg, args);
    }

    static error(msg: string, ...args: any[]) {
        this.log('ERROR', msg, args);
    }

    private static log(level: string, msg: string, args: any[]) {
        const timestamp = new Date().toISOString();

        if (this.isDev) {
            // Pretty Print for Localhost (Human Readable)
            const color = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : '\x1b[32m';
            const reset = '\x1b[0m';
            console.log(`${color}[${timestamp}] [${level}]${reset} ${msg}`, ...args);
        } else {
            // JSON Format for Production (Machine Readable / ELK Stack)
            const logObj = {
                timestamp,
                level,
                message: msg,
                context: args.length > 0 ? args : undefined
            };
            console.log(JSON.stringify(logObj));
        }
    }
}
