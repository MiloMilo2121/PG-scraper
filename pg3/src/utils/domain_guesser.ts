
/**
 * 🔍 DOMAIN GUESSER 🔍
 * Guesses email domain from company name when website is missing
 */

import * as dns from 'dns/promises';
import { Logger } from './logger';

// Generic domains to skip
const GENERIC_DOMAINS = new Set([
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
    'icloud.com', 'me.com', 'mac.com', 'aol.com', 'mail.com', 'protonmail.com',
    'zoho.com', 'yandex.com', 'gmx.com', 'gmx.net', 'gmx.de',
    'libero.it', 'virgilio.it', 'alice.it', 'tin.it', 'email.it',
    'tiscali.it', 'fastwebnet.it', 'aruba.it', 'pec.it', 'legalmail.it',
    'wordpress.com', 'blogspot.com', 'squarespace.com', 'wix.com', 'weebly.com',
    'godaddy.com', 'hostgator.com', 'bluehost.com', 'siteground.com',
    'linkedin.com', 'facebook.com', 'twitter.com', 'instagram.com', 'youtube.com'
]);

export class DomainGuesser {

    guessFromCompanyName(companyName: string): string[] {
        const guesses: string[] = [];
        const name = this.normalize(companyName);

        if (!name || name.length < 2) return [];

        const cleaned = name
            .replace(/\b(srl|spa|snc|sas|sapa|srls|ltd|llc|inc|gmbh|ag|bv|nv|co)\b/gi, '')
            .replace(/\b(societa|società|azienda|impresa|group|holding)\b/gi, '')
            .trim()
            .replace(/\s+/g, '');

        if (!cleaned || cleaned.length < 2) return [];

        guesses.push(`${cleaned}.it`);
        guesses.push(`${cleaned}.com`);
        guesses.push(`${cleaned}.eu`);
        guesses.push(`${cleaned}.net`);

        const words = name.replace(/\b(srl|spa|snc|sas)\b/gi, '').trim().split(/\s+/).filter(w => w.length > 1);
        if (words.length >= 2) {
            const concat = words.join('');
            const hyphenated = words.join('-');
            guesses.push(`${concat}.it`);
            guesses.push(`${concat}.com`);
            guesses.push(`${hyphenated}.it`);
            guesses.push(`${hyphenated}.com`);
        }

        return guesses.filter(d => !this.isGenericDomain(d));
    }

    async verifyDomainDns(domains: string[]): Promise<string | null> {
        for (const domain of domains) {
            try {
                const mx = await dns.resolveMx(domain);
                if (mx && mx.length > 0) {
                    // Logger.info(`DNS verified: ${domain} has MX records`);
                    return domain;
                }
            } catch (e) { }
        }
        return null;
    }

    isGenericDomain(domain: string): boolean {
        const normalized = domain.toLowerCase().trim();
        return GENERIC_DOMAINS.has(normalized);
    }

    async guessAndVerify(companyName: string): Promise<string | null> {
        const guesses = this.guessFromCompanyName(companyName);
        if (guesses.length === 0) return null;
        return await this.verifyDomainDns(guesses);
    }

    private normalize(name: string): string {
        return name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
}
