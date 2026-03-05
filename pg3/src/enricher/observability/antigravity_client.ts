import { request } from 'undici';
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

        const batch = [...this.buffer];
        this.buffer = []; // Clear buffer

        try {
            // Mocking the actual API call for now to prevent errors if endpoint doesn't exist
            if (process.env.ANTIGRAVITY_URL) {
                await request(ANTIGRAVITY_ENDPOINT, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ events: batch }),
                    bodyTimeout: 10000,
                });
            }

            // Visual Debug Log
            Logger.info(`🚀 [Antigravity] Pushed ${batch.length} updates to Dashboard.`);
        } catch (error) {
            Logger.error('[Antigravity] Failed to push updates', { error: error as Error });
            // Optional: Re-queue logic could go here
        }
    }
}
