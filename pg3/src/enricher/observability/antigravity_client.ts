import axios from 'axios';
import { CompanyInput } from '../types';
import { Logger } from '../utils/logger';
import * as fs from 'fs';

// Configuration (should be in config.ts eventually)
const ANTIGRAVITY_ENDPOINT = process.env.ANTIGRAVITY_URL || 'https://api.antigravity.io/v1/ingest';
const API_KEY = process.env.ANTIGRAVITY_KEY;

export class AntigravityClient {
    private static instance: AntigravityClient;
    private buffer: any[] = [];
    private flushInterval: NodeJS.Timeout | null = null;

    private constructor() {
        // Auto-flush every 2 seconds for "live" feel
        this.flushInterval = setInterval(() => this.flush(), 2000);
    }

    public static getInstance(): AntigravityClient {
        if (!AntigravityClient.instance) {
            AntigravityClient.instance = new AntigravityClient();
        }
        return AntigravityClient.instance;
    }

    /**
     * Sends a status update for a company.
     * Call this whenever a CSV row is written or a major step is completed.
     */
    public trackCompanyUpdate(company: CompanyInput, status: 'FOUND' | 'SEARCHING' | 'ENRICHED' | 'FAILED', metadata?: any) {
        const payload = {
            company_name: company.company_name,
            piva: company.vat_code || company.piva || company.fiscal_code, // Handle varied naming
            status: status,
            website: company.website,
            timestamp: new Date().toISOString(),
            ...metadata
        };

        this.buffer.push(payload);

        // Immediate flush if buffer gets full
        if (this.buffer.length >= 10) {
            this.flush();
        }
    }

    private async flush() {
        if (this.buffer.length === 0) return;

        // Snapshot the batch but DO NOT clear the buffer yet.
        // Only clear after a confirmed successful send to prevent data loss on network failure.
        const batch = [...this.buffer];

        try {
            if (process.env.ANTIGRAVITY_URL) {
                await axios.post(ANTIGRAVITY_ENDPOINT, { events: batch }, {
                    headers: { 'Authorization': `Bearer ${API_KEY}` },
                    timeout: 5000,
                });
            }
            // Success: safe to remove the sent items from the buffer
            this.buffer = this.buffer.slice(batch.length);
            Logger.info(`[Antigravity] Pushed ${batch.length} updates to Dashboard.`);
        } catch (error) {
            // Network failure: keep events in buffer so they retry on next flush cycle.
            // Cap the buffer at 500 to avoid unbounded growth during prolonged outages.
            Logger.error('[Antigravity] Failed to push updates — will retry', { error: error as Error });
            if (this.buffer.length > 500) {
                this.buffer = this.buffer.slice(-500); // Keep only most recent 500
                Logger.warn('[Antigravity] Buffer overflow during outage — oldest events dropped');
            }
        }
    }
}
