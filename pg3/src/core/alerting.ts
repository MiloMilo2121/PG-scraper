
import { Logger } from '../utils/logger';

export class AlertingService {
    public static async sendAlert(msg: string, level: 'info' | 'critical' = 'info') {
        Logger.error(`[ALERT][${level.toUpperCase()}] ${msg}`);
        // Integration with Slack/Email/Telegram would go here
    }
}
