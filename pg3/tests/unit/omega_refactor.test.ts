import { describe, it, expect } from 'vitest';
import { FinancialPatterns } from '../../src/enricher/core/financial/patterns';
import { ViesService } from '../../src/enricher/core/financial/vies';

describe('Omega Refactor Tests', () => {

    describe('FinancialPatterns', () => {
        it('should extract revenue correctly', () => {
            const text = "Fatturato: € 1.5 mln nel 2023";
            let matched = false;
            for (const pattern of FinancialPatterns.REVENUE) {
                const m = text.match(pattern);
                if (m) {
                    expect(m[1]).toBe('1.5 mln');
                    matched = true;
                    break;
                }
            }
            expect(matched).toBe(true);
        });

        it('should extract employees correctly', () => {
            const text = "Dipendenti: 10-20";
            let matched = false;
            for (const pattern of FinancialPatterns.EMPLOYEES) {
                const m = text.match(pattern);
                if (m) {
                    expect(m[1]).toBe('10-20');
                    matched = true;
                    break;
                }
            }
            expect(matched).toBe(true);
        });

        it('should extract PEC correctly', () => {
            const text = "Email: test@legalmail.it - scriveteci";
            const m = text.match(FinancialPatterns.PEC);
            expect(m?.[1]).toBe('test@legalmail.it');
        });
    });

    describe('ViesService', () => {
        const service = new ViesService();

        it('should fail strictly for invalid IT VAT checksum', async () => {
            // 12345678901 is invalid checksum
            const result = await service.validateVat('12345678901', 'IT');
            expect(result.isValid).toBe(false);
        });

        // We can't easily test the axios calls without mocking, but we verified the logic structure.
    });
});
