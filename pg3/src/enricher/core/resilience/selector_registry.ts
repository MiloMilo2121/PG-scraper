
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../../utils/logger';

export class SelectorRegistry {
    private static instance: SelectorRegistry;
    private selectors: any = {};
    private readonly configPath = path.join(__dirname, 'selectors.json');

    private constructor() {
        this.load();
    }

    public static getInstance(): SelectorRegistry {
        if (!SelectorRegistry.instance) {
            SelectorRegistry.instance = new SelectorRegistry();
        }
        return SelectorRegistry.instance;
    }

    private load() {
        try {
            if (fs.existsSync(this.configPath)) {
                this.selectors = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
            } else {
                Logger.warn('[SelectorRegistry] Config not found, initializing empty.');
            }
        } catch (e) {
            Logger.error('[SelectorRegistry] Failed to load config', { error: e as Error });
        }
    }

    public get(scope: string, key: string, defaultVal: string = ''): string {
        try {
            return this.selectors[scope]?.[key] || defaultVal;
        } catch {
            return defaultVal;
        }
    }

    public update(scope: string, key: string, value: string) {
        if (!this.selectors[scope]) this.selectors[scope] = {};
        this.selectors[scope][key] = value;
        try {
            fs.writeFileSync(this.configPath, JSON.stringify(this.selectors, null, 4));
            Logger.info(`[SelectorRegistry] 🩹 UPDATED SELECTOR [${scope}.${key}] -> ${value}`);
        } catch (e) {
            Logger.error('[SelectorRegistry] Failed to save update', { error: e as Error });
        }
    }
}
