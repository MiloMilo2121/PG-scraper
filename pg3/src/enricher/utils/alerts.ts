/**
 * 📢 TELEGRAM ALERTING
 * Task 46: Send critical alerts to Telegram
 */

import { Logger } from './logger';
import { config } from '../config';

export enum AlertLevel {
    INFO = 'ℹ️',
    SUCCESS = '✅',
    WARNING = '⚠️',
    ERROR = '❌',
    CRITICAL = '🚨',
}

export interface Alert {
    level: AlertLevel;
    title: string;
    message: string;
    data?: Record<string, any>;
}

export class AlertManager {
    private botToken?: string;
    private chatId?: string;
    private enabled: boolean;

    constructor() {
        this.botToken = process.env.TELEGRAM_BOT_TOKEN;
        this.chatId = process.env.TELEGRAM_CHAT_ID;
        this.enabled = !!(this.botToken && this.chatId);

        if (this.enabled) {
            Logger.info('📢 Telegram alerts enabled');
        } else {
            Logger.warn('📢 Telegram alerts disabled (no credentials)');
        }
    }

    /**
     * Send an alert
     */
    async send(alert: Alert): Promise<boolean> {
        if (!this.enabled) {
            Logger.info(`[ALERT:${alert.title}] ${alert.message}`);
            return false;
        }

        const text = this.formatMessage(alert);

        try {
            const response = await fetch(
                `https://api.telegram.org/bot${this.botToken}/sendMessage`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: this.chatId,
                        text,
                        parse_mode: 'HTML',
                    }),
                }
            );

            return response.ok;
        } catch (e) {
            Logger.error('Failed to send Telegram alert', { error: e as Error });
            return false;
        }
    }

    /**
     * Format message for Telegram
     */
    private formatMessage(alert: Alert): string {
        let msg = `${alert.level} <b>${alert.title}</b>\n\n${alert.message}`;

        if (alert.data) {
            msg += '\n\n<pre>';
            for (const [key, value] of Object.entries(alert.data)) {
                msg += `${key}: ${JSON.stringify(value)}\n`;
            }
            msg += '</pre>';
        }

        return msg;
    }

    // Convenience methods
    async info(title: string, message: string, data?: Record<string, any>) {
        return this.send({ level: AlertLevel.INFO, title, message, data });
    }

    async success(title: string, message: string, data?: Record<string, any>) {
        return this.send({ level: AlertLevel.SUCCESS, title, message, data });
    }

    async warning(title: string, message: string, data?: Record<string, any>) {
        return this.send({ level: AlertLevel.WARNING, title, message, data });
    }

    async error(title: string, message: string, data?: Record<string, any>) {
        return this.send({ level: AlertLevel.ERROR, title, message, data });
    }

    async critical(title: string, message: string, data?: Record<string, any>) {
        return this.send({ level: AlertLevel.CRITICAL, title, message, data });
    }
}

export const alertManager = new AlertManager();
