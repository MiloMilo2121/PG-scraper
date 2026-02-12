/**
 * 🚨 ERROR HANDLING UTILITIES (Law 205)
 * Standardized error classes for the application.
 */

export class AntigravityError extends Error {
    constructor(message: string, public code: string, public context?: Record<string, any>) {
        super(message);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}

export class NetworkError extends AntigravityError {
    constructor(message: string, context?: Record<string, any>) {
        super(message, 'NETWORK_ERROR', context);
    }
}

export class TorError extends AntigravityError {
    constructor(public message: string, public canRetry: boolean = true) {
        super(message, 'TOR_ERROR', { canRetry });
    }
}

export class CaptchaError extends AntigravityError {
    constructor(message: string = 'CAPTCHA detected and solving failed') {
        super(message, 'CAPTCHA_ERROR', { fatal: false });
    }
}

export class ConfigurationError extends AntigravityError {
    constructor(message: string) {
        super(message, 'CONFIG_ERROR', { fatal: true });
    }
}

export class ValidationError extends AntigravityError {
    constructor(message: string) {
        super(message, 'VALIDATION_ERROR', { fatal: false });
    }
}
