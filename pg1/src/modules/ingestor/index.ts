import fs from 'fs';
import { parse } from 'csv-parse';
import { InputRow } from '../../types';
import { z } from 'zod';

export interface IngestResult {
    row: InputRow;
    line_number: number;
}

const MIN_REQUIRED_FIELDS = ['company_name'];
const SIGNAL_FIELDS = ['phone', 'address', 'city', 'source_url'];

const InputRowSchema = z.object({
    company_name: z.string().trim().min(1),
    vat_id: z.string().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    province: z.string().optional(),
    postal_code: z.string().optional(),
    industry: z.string().optional(),
    source_url: z.string().optional(),
    initial_website: z.string().optional(),
    country: z.string().optional(),
}).passthrough();

const DELIMITER_SAMPLE_BYTES = 64 * 1024;

function detectDelimiter(filePath: string): string {
    let fd: number | null = null;
    try {
        fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(DELIMITER_SAMPLE_BYTES);
        const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
        if (bytesRead <= 0) return ',';

        const sample = buffer.toString('utf8', 0, bytesRead);
        const firstLine = sample.split(/\r?\n/)[0] || '';
        const commas = (firstLine.match(/,/g) || []).length;
        const semicolons = (firstLine.match(/;/g) || []).length;
        const tabs = (firstLine.match(/\t/g) || []).length;

        if (semicolons > commas && semicolons >= tabs) return ';';
        if (tabs > commas && tabs > semicolons) return '\t';
        return ',';
    } catch {
        return ',';
    } finally {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch { }
        }
    }
}

export async function* ingestCSV(filePath: string): AsyncGenerator<IngestResult, void, unknown> {
    const delimiter = detectDelimiter(filePath);

    const parser = fs.createReadStream(filePath).pipe(parse({
        columns: (header) => mapHeaders(header),
        delimiter: delimiter,
        trim: true,
        skip_empty_lines: true,
        relax_column_count: true
    }));

    let lineCount = 0;
    for await (const record of parser) {
        lineCount++;
        const parsed = InputRowSchema.safeParse(record);
        if (!parsed.success) continue;
        const row = parsed.data as InputRow;

        // Basic validation: must have company_name and at least one signal
        if (!row.company_name) continue;

        const hasSignal = SIGNAL_FIELDS.some(field => !!row[field as keyof InputRow]);

        if (hasSignal) {
            yield { row, line_number: lineCount };
        }
    }
}

function mapHeaders(headers: string[]): string[] {
    // Normalize headers to match InputRow keys
    return headers.map(h => {
        const slug = h.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');

        // Exact overrides for known datasets
        if (slug === 'profile_url') return 'source_url';
        if (slug === 'website') return 'initial_website';

        if (slug.includes('ragione') || slug.includes('company') || slug.includes('azienda')) return 'company_name';
        if (slug.includes('p_iva') || slug.includes('partita_iva') || slug.includes('vat')) return 'vat_id';
        if (slug.includes('telef') || slug.includes('phone') || slug.includes('tel')) return 'phone';
        if (slug.includes('indirizzo') || slug.includes('address') || slug.includes('via')) return 'address';
        if (slug.includes('citta') || slug.includes('city') || slug.includes('localita') || slug.includes('comune')) return 'city';
        if (slug.includes('prov') || slug.includes('province')) return 'province';
        if (slug.includes('cap') || slug.includes('zip') || slug.includes('postal')) return 'postal_code';
        if (slug.includes('sito') || slug.includes('url') || slug.includes('web')) return 'source_url';
        if (slug.includes('cat') || slug.includes('ind') || slug.includes('settore')) return 'industry';
        return slug;
    });
}
