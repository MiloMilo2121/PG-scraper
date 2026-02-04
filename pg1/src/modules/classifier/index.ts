import { ExtractedContent } from '../extractor';
import { SiteType } from '../../types';
import { getConfig } from '../../config';

export class SiteClassifier {

    static classify(domain: string, content: ExtractedContent): { type: SiteType, parked_count: number } {
        const config = getConfig();
        const lowerDomain = domain.toLowerCase();

        // 1. Hard lists
        if (config.lists.directory_domains.some(d => lowerDomain.includes(d))) return { type: SiteType.DIRECTORY, parked_count: 0 };
        if (config.lists.social_domains.some(d => lowerDomain.includes(d))) return { type: SiteType.SOCIAL, parked_count: 0 };
        if (config.lists.marketplace_domains.some(d => lowerDomain.includes(d))) return { type: SiteType.MARKETPLACE, parked_count: 0 };

        // 2. Parked Detection
        let parkedCount = 0;
        const textLower = content.text.toLowerCase();
        const titleLower = content.meta.title.toLowerCase();

        for (const indicator of config.lists.parked_indicators) {
            if (textLower.includes(indicator) || titleLower.includes(indicator)) {
                parkedCount++;
            }
        }

        if (parkedCount >= 2) return { type: SiteType.PARKED, parked_count: parkedCount };

        // 3. Corporate Verification (Positive Proof)
        // We default to UNKNOWN or CORPORATE based on signals?
        // Prompt says: Hard blacklist -> Parked detection -> Positive corporate proof.

        let corporateSignals = 0;
        if (content.links.privacy.length > 0) corporateSignals++;
        if (content.links.contact.length > 0) corporateSignals++;
        if (content.vats.length > 0) corporateSignals++;
        if (content.json_ld.some(j => j['@type'] === 'Organization' || j['@type'] === 'LocalBusiness')) corporateSignals++;
        if (content.emails.some(e => e.includes(domain))) corporateSignals++;

        if (corporateSignals >= 2) return { type: SiteType.CORPORATE, parked_count: parkedCount };

        // If no strong positive proof and no negative proof, generic content might be small biz.
        // If text length is very short, suspicious.
        if (content.text.length < 200) return { type: SiteType.UNKNOWN, parked_count: 0 };

        // Fallback: assume corporate if not blacklisted, but with low confidence implicit in scoring.
        return { type: SiteType.CORPORATE, parked_count: parkedCount };
    }
}
