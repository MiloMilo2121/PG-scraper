import { ExtractedContent } from '../extractor';
import { Normalizer } from '../normalizer';
import { NormalizedEntity, Evidence, SiteType } from '../../types';
import { getConfig } from '../../config';

export class SignalExtractor {

    static extract(content: ExtractedContent, input: NormalizedEntity, validity: { dns_ok: boolean, http_ok: boolean, is_https: boolean, site_type: SiteType }): Evidence {
        const config = getConfig();

        // Normalize found phones
        const foundPhonesNorm: string[] = [];
        content.phones.concat(content.text.match(/\+?39\s?[0-9\s.-]{6,}/g) || []).forEach(p => {
            const n = Normalizer.normalizePhone(p);
            foundPhonesNorm.push(...n.formatted);
        });
        const uniquePhones = [...new Set(foundPhonesNorm)];

        // Check Matches
        // S1 Phone
        const phoneMatch = input.phones.some(p => uniquePhones.includes(p));

        // S2 Address
        // Simple token overlap for now (Jaccard or Dice coefficient would be better)
        const pageTextNorm = content.text.toLowerCase();
        const addressMatchScore = this.calculateTokenMatch(input.address_tokens, pageTextNorm);

        // S3 Name (Company vs Title/H1)
        const titleNorm = content.meta.title.toLowerCase();
        const nameMatchScore = Math.max(
            this.calculateTokenMatch(input.company_name.split(' '), titleNorm),
            this.calculateTokenMatch(input.company_name.split(' '), pageTextNorm.substring(0, 1000)) // Top 1000 chars often contain header
        );

        // VAT
        // match against input if available, otherwise just presence
        const vatFound = content.vats.length > 0;

        return {
            phones_found: uniquePhones,
            addresses_found: [], // extracted addresses not implemented fully yet
            vat_ids_found: content.vats,
            emails_found: content.emails,
            social_links_found: content.links.external.filter(u => config.lists.social_domains.some(d => u.includes(d))),
            meta_title: content.meta.title,
            meta_description: content.meta.description,
            h1_headers: content.h1Headers || [], // Use extracted H1s from ContentExtractor
            site_type: validity.site_type,
            dns_ok: validity.dns_ok,
            http_ok: validity.http_ok,
            is_https: validity.is_https,
            has_privacy_policy: content.links.privacy.length > 0,
            has_contact_page: content.links.contact.length > 0,
            parked_indicators_count: 0, // Calculated by Classifier
            structured_data: content.json_ld,
            // Match scores for Scorer
            address_match_score: addressMatchScore,
            name_match_score: nameMatchScore
        };
    }

    private static calculateTokenMatch(tokens: string[], text: string): number {
        if (tokens.length === 0) return 0;
        let hits = 0;
        for (const t of tokens) {
            if (text.includes(t)) hits++;
        }
        return hits / tokens.length;
    }
}
