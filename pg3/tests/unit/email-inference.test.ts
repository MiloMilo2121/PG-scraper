import { describe, expect, it } from 'vitest';
import {
    buildGenericEmailCandidates,
    getHostname,
    getRegistrableDomain,
    inferEmailFromDomain,
    isInferenceSafeDomain,
} from '../../src/enricher/utils/email_inference';

describe('email_inference', () => {
    it('extracts hostname and registrable domain from URLs', () => {
        expect(getHostname('https://www.gierreimmobiliare.com/contatti')).toBe('gierreimmobiliare.com');
        expect(getRegistrableDomain('alessandria4.tecnocasa.it')).toBe('tecnocasa.it');
    });

    it('denies directory and franchise roots for inference', () => {
        expect(isInferenceSafeDomain('immobiliare.it')).toBe(false);
        expect(isInferenceSafeDomain('tecnocasa.it')).toBe(false);
        expect(isInferenceSafeDomain('gierreimmobiliare.com')).toBe(true);
    });

    it('ranks generic business mailboxes by business likelihood', () => {
        const candidates = buildGenericEmailCandidates('Studio Lentini', 'studiolentini.it');
        expect(candidates[0]).toBe('studio@studiolentini.it');
        expect(candidates).toContain('info@studiolentini.it');
        expect(candidates).toContain('studio@studiolentini.it');
    });

    it('returns an inferred email when MX exists on a safe domain', async () => {
        const result = await inferEmailFromDomain(
            'Gierre Immobiliare',
            'gierreimmobiliare.com',
            'website_mx',
            async () => [{ exchange: 'mx.example.test', priority: 10 }],
        );

        expect(result?.inferredEmail).toBe('info@gierreimmobiliare.com');
        expect(result?.mode).toBe('website_mx');
    });

    it('does not infer on denied domains even if MX exists', async () => {
        const result = await inferEmailFromDomain(
            'Tecnocasa Alessandria',
            'tecnocasa.it',
            'website_mx',
            async () => [{ exchange: 'mx.example.test', priority: 10 }],
        );

        expect(result).toBeNull();
    });
});
