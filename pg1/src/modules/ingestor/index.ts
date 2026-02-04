import fs from 'fs';
import { parse } from 'csv-parse';
import { InputRow } from '../../types';

export interface IngestResult {
    row: InputRow;
    line_number: number;
}

const MIN_REQUIRED_FIELDS = ['company_name'];
const SIGNAL_FIELDS = ['phone', 'address', 'city', 'source_url'];

export async function* ingestCSV(filePath: string): AsyncGenerator<IngestResult, void, unknown> {
    const fileContent = fs.readFileSync(filePath, 'utf8'); // Read full file to auto-detect? Or stream?
    // Stream is better for memory, but auto-detect delimiter is easier with sample.
    // We'll trust csv-parse's slightly better auto-detect or default to comma/semicolon loop.

    // Actually, we'll try to read the first line to detect delimiter.
    const firstLine = fs.readFileSync(filePath, { encoding: 'utf8', flag: 'r' }).split('\n')[0];
    let delimiter = ',';
    if ((firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length) {
        delimiter = ';';
    } else if ((firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length) {
        delimiter = '\t';
    }

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
        const row = record as InputRow;

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
