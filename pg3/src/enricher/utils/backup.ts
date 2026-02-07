/**
 * 💾 BACKUP MANAGER
 * Task 48: S3/FTP backup for critical data
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';

export interface BackupConfig {
    type: 's3' | 'ftp' | 'local';
    bucket?: string;
    host?: string;
    user?: string;
    password?: string;
    remotePath?: string;
    localPath: string;
}

export class BackupManager {
    private config: BackupConfig;

    constructor(config: Partial<BackupConfig> = {}) {
        this.config = {
            type: 'local',
            localPath: './backups',
            ...config,
        };

        // Ensure backup directory exists
        if (!fs.existsSync(this.config.localPath)) {
            fs.mkdirSync(this.config.localPath, { recursive: true });
        }
    }

    /**
     * Backup SQLite database
     */
    async backupDatabase(dbPath: string): Promise<string> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `db_backup_${timestamp}.sqlite`;
        const backupPath = path.join(this.config.localPath, backupName);

        try {
            // Copy database file
            fs.copyFileSync(dbPath, backupPath);
            Logger.info(`💾 Database backed up to ${backupPath}`);

            // Compress (optional, requires external library)
            return backupPath;
        } catch (e) {
            Logger.error('Database backup failed', { error: e as Error });
            throw e;
        }
    }

    /**
     * Backup CSV/JSON exports
     */
    async backupExports(exportDir: string): Promise<string[]> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDir = path.join(this.config.localPath, `exports_${timestamp}`);

        try {
            fs.mkdirSync(backupDir, { recursive: true });

            const files = fs.readdirSync(exportDir)
                .filter(f => f.endsWith('.csv') || f.endsWith('.json'));

            const backed: string[] = [];
            for (const file of files) {
                const src = path.join(exportDir, file);
                const dest = path.join(backupDir, file);
                fs.copyFileSync(src, dest);
                backed.push(dest);
            }

            Logger.info(`💾 Backed up ${backed.length} export files to ${backupDir}`);
            return backed;
        } catch (e) {
            Logger.error('Export backup failed', { error: e as Error });
            throw e;
        }
    }

    /**
     * List available backups
     */
    listBackups(): string[] {
        try {
            return fs.readdirSync(this.config.localPath)
                .filter(f => f.includes('backup'))
                .sort()
                .reverse();
        } catch (error) {
            Logger.warn('Listing backups failed', { error: error as Error });
            return [];
        }
    }

    /**
     * Cleanup old backups (keep last N)
     */
    async cleanup(keepLast: number = 5): Promise<number> {
        const backups = this.listBackups();
        const toDelete = backups.slice(keepLast);

        for (const backup of toDelete) {
            const fullPath = path.join(this.config.localPath, backup);
            try {
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory()) {
                    fs.rmSync(fullPath, { recursive: true });
                } else {
                    fs.unlinkSync(fullPath);
                }
            } catch (error) {
                Logger.warn('Failed to remove old backup', { error: error as Error, backup: fullPath });
            }
        }

        if (toDelete.length > 0) {
            Logger.info(`🧹 Cleaned up ${toDelete.length} old backups`);
        }
        return toDelete.length;
    }
}

export const backupManager = new BackupManager();
