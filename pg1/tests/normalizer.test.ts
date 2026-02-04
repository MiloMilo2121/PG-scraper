import { Normalizer } from '../src/modules/normalizer';

describe('Normalizer Module', () => {
    describe('Company Name', () => {
        test('removes legal suffixes', () => {
            expect(Normalizer.normalizeCompany('Acme S.r.l.')).toBe('acme');
            expect(Normalizer.normalizeCompany('Foo Bar SPA')).toBe('foo bar');
            expect(Normalizer.normalizeCompany('Societa Cooperativa Beta')).toBe('beta');
        });

        test('cleans basic noise', () => {
            expect(Normalizer.normalizeCompany('Il Ristorante Da Mario')).toBe('da mario');
            // 'Il' is not in stopword list in my implementation check? 
            // 'Ristorante' IS in stopwords.
        });
    });

    describe('Phone Numbers', () => {
        test('normalizes standard IT landline', () => {
            const res = Normalizer.normalizePhone('02 12345678');
            expect(res.formatted).toContain('+390212345678');
        });

        test('normalizes IT mobile', () => {
            const res = Normalizer.normalizePhone('333-123.45.67');
            expect(res.formatted).toContain('+393331234567');
        });

        test('handles international prefix', () => {
            const res = Normalizer.normalizePhone('+39 06 12345');
            expect(res.formatted).toContain('+390612345');
            // Handle double 0039
            const res2 = Normalizer.normalizePhone('00390612345');
            expect(res2.formatted).toContain('+390612345');
        });

        test('handles multiple phones', () => {
            const res = Normalizer.normalizePhone('02/12345; 333456789');
            expect(res.formatted).toContain('+390212345');
            expect(res.formatted).toContain('+39333456789');
        });
    });
});
