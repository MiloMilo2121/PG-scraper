import * as fs from 'fs';
import * as path from 'path';
import { createObjectCsvWriter } from 'csv-writer';
import { parse } from 'fast-csv';
import { IPersistenceLayer, AnalysisResult } from '../interfaces/types';
import { CompanyInput } from '../../../company_types';

export class CsvPersistence implements IPersistenceLayer {
    private outputDir: string;
    private validPath: string;
    private invalidPath: string;
    private notFoundPath: string;
    private inputFile: string;

    constructor(outputDir: string, inputFile: string) {
        this.outputDir = outputDir;
        this.inputFile = inputFile;
        this.validPath = path.join(outputDir, 'found_valid.csv');
        this.invalidPath = path.join(outputDir, 'found_invalid.csv');
        this.notFoundPath = path.join(outputDir, 'not_found.csv');

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
    }

    async loadPending(): Promise<CompanyInput[]> {
        // 1. Load all processed company names
        const processed = new Set<string>();
        const processedFiles = [this.validPath, this.invalidPath, this.notFoundPath];

        for (const file of processedFiles) {
            const records = await this.readCsv(file);
            records.forEach((r: any) => processed.add(r.company_name));
        }

        // 2. Load all input companies
        const allCompanies = await this.readCsv(this.inputFile);

        // 3. Filter
        return allCompanies.filter((c: any) => !processed.has(c.company_name));
    }

    async saveResult(company: CompanyInput, result: AnalysisResult): Promise<void> {
        const record = {
            ...company,
            website: result.url,
            confidence: result.confidence,
            validation_level: result.details.level || 'Unknown',
            validation_reason: result.details.reason || '',
            discovery_method: result.details.method || 'Unknown'
        };

        if (result.isValid) {
            await this.writeToCsv(this.validPath, record);
        } else if (result.url) {
            // Found but invalid
            await this.writeToCsv(this.invalidPath, record);
        } else {
            // Not found
            await this.writeToCsv(this.notFoundPath, record);
        }
    }

    async markAsProcessed(companyId: string): Promise<void> {
        // In CSV world, saving the result IS marking as processed.
        // No separate action needed.
        return Promise.resolve();
    }

    private async readCsv(filePath: string): Promise<any[]> {
        if (!fs.existsSync(filePath)) return [];
        return new Promise((resolve, reject) => {
            const rows: any[] = [];
            fs.createReadStream(filePath)
                .pipe(parse({ headers: true, ignoreEmpty: true, discardUnmappedColumns: true }))
                .on('data', r => rows.push(r))
                .on('end', () => resolve(rows))
                .on('error', reject);
        });
    }

    private async writeToCsv(filePath: string, record: any): Promise<void> {
        const header = [
            { id: 'company_name', title: 'company_name' },
            { id: 'city', title: 'city' },
            { id: 'province', title: 'province' },
            { id: 'website', title: 'website' },
            { id: 'confidence', title: 'confidence' },
            { id: 'validation_level', title: 'validation_level' },
            { id: 'validation_reason', title: 'validation_reason' },
            { id: 'discovery_method', title: 'discovery_method' }
        ];

        // Ensure we strictly follow the header structure, merging extra fields if needed or ignoring them
        // For simplicity, we just pass the record and let csv-writer filter by 'id'

        const writer = createObjectCsvWriter({
            path: filePath,
            header: header,
            append: fs.existsSync(filePath)
        });

        await writer.writeRecords([record]);
    }
}
