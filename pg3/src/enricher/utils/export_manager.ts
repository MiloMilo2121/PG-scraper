/**
 * 📤 ASYNC EXPORT MANAGER
 * Task 40: Export enriched data to various formats
 */

import * as fs from 'fs';
import * as path from 'path';
import { createObjectCsvWriter } from 'csv-writer';
import { Logger } from './logger';
import { LeadScorerV2, LeadData } from './lead_scorer_v2';

export interface ExportOptions {
    format: 'csv' | 'json';
    minScore?: number;
    categories?: Array<'HOT' | 'WARM' | 'COLD' | 'DEAD'>;
    fields?: string[];
    sortBy?: 'score' | 'name' | 'city';
    outputDir?: string;
}

export class ExportManager {
    private outputDir: string;

    constructor(outputDir: string = './output/exports') {
        this.outputDir = outputDir;
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    /**
     * Export leads to CSV
     */
    async exportToCSV(
        leads: LeadData[],
        filename: string,
        options: Partial<ExportOptions> = {}
    ): Promise<string> {
        const filtered = this.filterLeads(leads, options);
        const sorted = this.sortLeads(filtered, options.sortBy);

        // Score each lead
        const scored = sorted.map(lead => ({
            ...lead,
            ...LeadScorerV2.score(lead),
        }));

        const filePath = path.join(this.outputDir, `${filename}.csv`);

        // Determine headers from first record
        const allFields = Object.keys(scored[0] || {});
        const fields = options.fields || allFields;

        const writer = createObjectCsvWriter({
            path: filePath,
            header: fields.map(f => ({ id: f, title: f })),
        });

        await writer.writeRecords(scored);
        Logger.info(`📤 Exported ${scored.length} leads to ${filePath}`);

        return filePath;
    }

    /**
     * Export leads to JSON
     */
    async exportToJSON(
        leads: LeadData[],
        filename: string,
        options: Partial<ExportOptions> = {}
    ): Promise<string> {
        const filtered = this.filterLeads(leads, options);
        const sorted = this.sortLeads(filtered, options.sortBy);

        const scored = sorted.map(lead => ({
            ...lead,
            score: LeadScorerV2.score(lead),
        }));

        const filePath = path.join(this.outputDir, `${filename}.json`);
        fs.writeFileSync(filePath, JSON.stringify(scored, null, 2));

        Logger.info(`📤 Exported ${scored.length} leads to ${filePath}`);
        return filePath;
    }

    /**
     * Export segmented by category
     */
    async exportSegmented(
        leads: LeadData[],
        baseFilename: string
    ): Promise<Record<string, string>> {
        const paths: Record<string, string> = {};

        const categories: Array<'HOT' | 'WARM' | 'COLD' | 'DEAD'> = ['HOT', 'WARM', 'COLD', 'DEAD'];

        for (const category of categories) {
            const filtered = leads.filter(lead => {
                const score = LeadScorerV2.score(lead);
                return score.category === category;
            });

            if (filtered.length > 0) {
                paths[category] = await this.exportToCSV(
                    filtered,
                    `${baseFilename}_${category.toLowerCase()}`,
                    { categories: [category] }
                );
            }
        }

        return paths;
    }

    /**
     * Generate summary report
     */
    async generateReport(leads: LeadData[], filename: string): Promise<string> {
        const scored = leads.map(lead => ({
            ...lead,
            score: LeadScorerV2.score(lead),
        }));

        const report = {
            generatedAt: new Date().toISOString(),
            totalLeads: leads.length,
            categories: {
                HOT: scored.filter(l => l.score.category === 'HOT').length,
                WARM: scored.filter(l => l.score.category === 'WARM').length,
                COLD: scored.filter(l => l.score.category === 'COLD').length,
                DEAD: scored.filter(l => l.score.category === 'DEAD').length,
            },
            averageScore: scored.reduce((sum, l) => sum + l.score.total, 0) / scored.length || 0,
            dataQuality: {
                withWebsite: scored.filter(l => l.website).length,
                withVAT: scored.filter(l => l.vat).length,
                withEmail: scored.filter(l => l.email).length,
                withPhone: scored.filter(l => l.phone).length,
            },
        };

        const filePath = path.join(this.outputDir, `${filename}_report.json`);
        fs.writeFileSync(filePath, JSON.stringify(report, null, 2));

        Logger.info(`📊 Generated report: ${filePath}`);
        return filePath;
    }

    /**
     * Filter leads based on options
     */
    private filterLeads(leads: LeadData[], options: Partial<ExportOptions>): LeadData[] {
        let filtered = [...leads];

        if (options.minScore !== undefined) {
            filtered = filtered.filter(lead => {
                const score = LeadScorerV2.score(lead);
                return score.total >= options.minScore!;
            });
        }

        if (options.categories?.length) {
            filtered = filtered.filter(lead => {
                const score = LeadScorerV2.score(lead);
                return options.categories!.includes(score.category);
            });
        }

        return filtered;
    }

    /**
     * Sort leads
     */
    private sortLeads(leads: LeadData[], sortBy?: string): LeadData[] {
        const sorted = [...leads];

        switch (sortBy) {
            case 'score':
                return sorted.sort((a, b) => {
                    const scoreA = LeadScorerV2.score(a).total;
                    const scoreB = LeadScorerV2.score(b).total;
                    return scoreB - scoreA;
                });
            case 'name':
                return sorted.sort((a, b) => a.company_name.localeCompare(b.company_name));
            case 'city':
                return sorted.sort((a, b) => (a.city || '').localeCompare(b.city || ''));
            default:
                return sorted;
        }
    }
}

export const exportManager = new ExportManager();
