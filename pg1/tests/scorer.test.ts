import { Scorer } from '../src/modules/scorer';
import { Evidence, NormalizedEntity, SiteType } from '../src/types';
import { loadConfig } from '../src/config';

beforeAll(() => {
    loadConfig();
});

const mockEvidence: Evidence = {
    phones_found: [],
    addresses_found: [],
    vat_ids_found: [],
    emails_found: [],
    social_links_found: [],
    meta_title: 'Test Company Generic',
    h1_headers: [],
    site_type: SiteType.CORPORATE,
    dns_ok: true,
    http_ok: true,
    is_https: true,
    has_privacy_policy: true,
    has_contact_page: true,
    parked_indicators_count: 0
};

const mockInput: NormalizedEntity = {
    company_name: 'Super Company',
    city: 'Milan',
    province: 'MI',
    address_tokens: ['via', 'roma'],
    phones: ['+390212345678'],
    raw_phones: ['0212345678'],
    fingerprint: '123',
    source_row: { company_name: 'Super Company' }
};

describe('Scorer Engine', () => {
    test('S1: Phone Exact Match should give strong points', () => {
        const ev = { ...mockEvidence, phones_found: ['+390212345678'] };
        const score = Scorer.score(ev, mockInput, 1);
        expect(score.strong_signals_score).toBeGreaterThanOrEqual(45);
        expect(score.details).toContain('S1: Phone Exact Match');
    });

    test('S3: Name Fuzzy Match', () => {
        // Super Company vs Super Company SpA
        const ev = { ...mockEvidence, meta_title: 'Super Company SpA Official Site' };
        const score = Scorer.score(ev, mockInput, 1);
        // Jaccard should be high
        expect(score.strong_signals_score).toBeGreaterThan(0);
        expect(score.details.join(',')).toContain('S3: Name Match');
    });

    test('P1: Penalty for bad site type', () => {
        const ev = { ...mockEvidence, site_type: SiteType.DIRECTORY };
        const score = Scorer.score(ev, mockInput, 1);
        expect(score.penalties_score).toBe(100);
        expect(score.final_score).toBe(0);
    });

    test('S4: VAT Exact Match', () => {
        const inputWithVat: NormalizedEntity = { ...mockInput, vat_id: '00743110157' };
        const ev = { ...mockEvidence, vat_ids_found: ['00743110157', '12345'] };

        const score = Scorer.score(ev, inputWithVat, 1);
        expect(score.strong_signals_score).toBeGreaterThanOrEqual(100); // 100 points for VAT
        expect(score.details).toContain('S4: VAT Exact Match (00743110157)');
    });

    test('Phone Frequency Reduction', () => {
        const ev = { ...mockEvidence, phones_found: ['+390212345678'] };
        // Freq 3 -> Should reduce points
        const score = Scorer.score(ev, mockInput, 3);
        // Standard is 45, reduced is 25
        // Note: If fuzzy match adds points, need to account for it. Here title doesn't match effectively (generic).
        // S1=25.
        // C5 HTTPS=2. Total 27?
        // Let's check logic. Reduced is 25.
        // Logic: if (phoneMatches.length > 0) { if (freq>=3) s1=25 ... }

        // We expect "S1: Phone Match (Reduced due to Freq)"
        expect(score.details).toContain('S1: Phone Match (Reduced due to Freq)');
    });
});
