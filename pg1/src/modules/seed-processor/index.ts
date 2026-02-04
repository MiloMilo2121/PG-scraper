import { fetcher } from '../fetcher';
import { ContentExtractor } from '../extractor';
import { Normalizer } from '../normalizer';
import { InputRow, NormalizedEntity } from '../../types';
import { URL } from 'url';

export interface SeedResult {
    external_urls: string[];
    signals: {
        phones: string[];
        addresses: string[]; // tokens
    };
}

export class SeedProcessor {

    static async process(sourceUrl: string, row: InputRow): Promise<SeedResult> {
        if (!sourceUrl) return { external_urls: [], signals: { phones: [], addresses: [] } };

        try {
            const result = await fetcher.fetch(sourceUrl);
            if (result.status >= 400) return { external_urls: [], signals: { phones: [], addresses: [] } };

            const extracted = ContentExtractor.extract(result.data, result.finalUrl);

            // Filter external URLs: remove known directory domains (PagineGialle etc)
            // For now, we accept all external, filtering will happen in Candidate Deduper/Classifier
            // BUT, we should try to be smart about what looks like "Visit Website" button.

            // Heuristic: If seed is a directory (e.g. paginegialle), external link often has specific class or text.
            // But we just grab all external links for now as candidates.

            // Extract signals from seed page to cross-ref
            // Phones
            const seedPhones: string[] = [];
            extracted.phones.forEach(p => {
                const norm = Normalizer.normalizePhone(p);
                seedPhones.push(...norm.formatted);
            });

            return {
                external_urls: extracted.links.external,
                signals: {
                    phones: [...new Set(seedPhones)],
                    addresses: [] // extraction logic from text is hard without geocoder, maybe skip for MVP or use simple token matching
                }
            };

        } catch (e) {
            return { external_urls: [], signals: { phones: [], addresses: [] } };
        }
    }
}
