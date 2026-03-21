export enum ErrorCategory {
    NETWORK = 'NETWORK',
    BROWSER = 'BROWSER',
    PARSING = 'PARSING',
    VALIDATION = 'VALIDATION',
    AUTH = 'AUTH',
    LOGIC = 'LOGIC'
}

export interface LogContext {
    company_id?: string;
    company_name?: string;
    url?: string;
    error?: Error;
    error_category?: ErrorCategory;
    duration_ms?: number;
    [key: string]: any;
}

export class Logger {
    private static isDev = process.env.NODE_ENV !== 'production';
    private static serviceName = process.env.SERVICE_NAME || 'antigravity-enricher';

    static info(msg: string, context?: LogContext) {
        this.log('INFO', msg, context);
    }

    static warn(msg: string, context?: LogContext) {
        this.log('WARN', msg, context);
    }

    static error(msg: string, context?: LogContext) {
        this.log('ERROR', msg, context);
    }

    static debug(msg: string, context?: LogContext) {
        if (this.isDev) {
            this.log('DEBUG', msg, context);
        }
    }

    static fatal(msg: string, context?: LogContext) {
        this.log('FATAL', msg, context);
    }

    static categorizeError(error: Error): ErrorCategory {
        const msg = error.message.toLowerCase();

        if (msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('socket')) {
            return ErrorCategory.NETWORK;
        }
        if (msg.includes('browser') || msg.includes('puppeteer') || msg.includes('target closed') || msg.includes('detached')) {
            return ErrorCategory.BROWSER;
        }
        if (msg.includes('parse') || msg.includes('unexpected token') || msg.includes('json')) {
            return ErrorCategory.PARSING;
        }
        if (msg.includes('validation') || msg.includes('zod') || msg.includes('invalid')) {
            return ErrorCategory.VALIDATION;
        }
        if (msg.includes('401') || msg.includes('403') || msg.includes('429') || msg.includes('api key') || msg.includes('rate limit')) {
            return ErrorCategory.AUTH;
        }
        return ErrorCategory.LOGIC;
    }

    static logError(msg: string, error: Error, extraContext?: Partial<LogContext>) {
        this.error(msg, {
            ...extraContext,
            error,
            error_category: this.categorizeError(error),
        });
    }

    private static log(level: string, msg: string, context?: LogContext) {
        const timestamp = new Date().toISOString();

        let errorStack: string | undefined;
        if (context?.error instanceof Error) {
            errorStack = context.error.stack;
            context = {
                ...context,
                error_message: context.error.message,
                error_stack: errorStack
            };
            delete (context as any).error;
        }

        if (this.isDev) {
            const colors: Record<string, string> = {
                INFO: '\x1b[32m',
                WARN: '\x1b[33m',
                ERROR: '\x1b[31m',
                FATAL: '\x1b[35m'
            };
            const color = colors[level] || '\x1b[37m';
            const reset = '\x1b[0m';

            let output = `${color}[${timestamp}] [${level}]${reset} ${msg}`;
            if (context) {
                const brief = {
                    company: context.company_name,
                    url: context.url,
                    category: context.error_category,
                    error: context.error_message
                };
                const filtered = Object.fromEntries(
                    Object.entries(brief).filter(([_, value]) => value !== undefined)
                );
                if (Object.keys(filtered).length > 0) {
                    output += ` ${JSON.stringify(filtered)}`;
                }
            }
            console.log(output);

            if ((level === 'ERROR' || level === 'FATAL') && errorStack) {
                console.log(`${color}${errorStack}${reset}`);
            }
            return;
        }

        console.log(JSON.stringify({
            timestamp,
            level,
            service: this.serviceName,
            message: msg,
            ...context
        }));
    }
}
