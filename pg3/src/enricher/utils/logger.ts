/**
 * 📝 ANTIGRAVITY STRUCTURED LOGGER
 * Task 8: No Silent Death - Full Error Categorization
 * 
 * LAW #6: Errors are signals. Catch them, categorize them, and act.
 */

export enum ErrorCategory {
    NETWORK = 'NETWORK',      // Timeout, DNS, Connection refused
    BROWSER = 'BROWSER',      // Puppeteer crash, page not responding
    PARSING = 'PARSING',      // HTML/JSON parsing failures
    VALIDATION = 'VALIDATION', // Data validation failures (Zod, VIES)
    AUTH = 'AUTH',            // API key invalid, rate limited
    LOGIC = 'LOGIC'           // Programmer error (bugs)
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

    /**
     * 💀 FATAL: Use for unrecoverable errors that should trigger alerts
     */
    static fatal(msg: string, context?: LogContext) {
        this.log('FATAL', msg, context);
        // Future: Trigger Telegram/Slack alert here
    }

    /**
     * 🔥 Categorize an error automatically
     */
    static categorizeError(error: Error): ErrorCategory {
        const msg = error.message.toLowerCase();
        const stack = error.stack?.toLowerCase() || '';

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

    /**
     * 📊 Log an error with automatic categorization
     */
    static logError(msg: string, error: Error, extraContext?: Partial<LogContext>) {
        const category = this.categorizeError(error);
        this.error(msg, {
            ...extraContext,
            error,
            error_category: category
        });
    }

    private static log(level: string, msg: string, context?: LogContext) {
        const timestamp = new Date().toISOString();

        // Extract error stack if present
        let errorStack: string | undefined;
        if (context?.error instanceof Error) {
            errorStack = context.error.stack;
            // Replace error object with serializable version
            context = {
                ...context,
                error_message: context.error.message,
                error_stack: errorStack
            };
            delete (context as any).error;
        }

        if (this.isDev) {
            // Pretty Print for Localhost (Human Readable)
            const colors: Record<string, string> = {
                INFO: '\x1b[32m',   // Green
                WARN: '\x1b[33m',   // Yellow
                ERROR: '\x1b[31m',  // Red
                FATAL: '\x1b[35m'   // Magenta
            };
            const color = colors[level] || '\x1b[37m';
            const reset = '\x1b[0m';

            let output = `${color}[${timestamp}] [${level}]${reset} ${msg}`;
            if (context) {
                // Only show key fields in dev mode
                const brief = {
                    company: context.company_name,
                    url: context.url,
                    category: context.error_category,
                    error: context.error_message
                };
                const filtered = Object.fromEntries(
                    Object.entries(brief).filter(([_, v]) => v !== undefined)
                );
                if (Object.keys(filtered).length > 0) {
                    output += ` ${JSON.stringify(filtered)}`;
                }
            }
            console.log(output);

            // Print stack trace for errors in dev
            if (level === 'ERROR' || level === 'FATAL') {
                if (errorStack) console.log(`${color}${errorStack}${reset}`);
            }
        } else {
            // JSON Format for Production (Machine Readable / ELK Stack)
            const logObj = {
                timestamp,
                level,
                service: this.serviceName,
                message: msg,
                ...context
            };
            console.log(JSON.stringify(logObj));
        }
    }
}
