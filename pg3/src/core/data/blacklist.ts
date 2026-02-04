
export class Blacklist {
    private static domains = new Set([
        'paginegialle.it',
        'facebook.com',
        'linkedin.com',
        'instagram.com',
        'twitter.com',
        'youtube.com',
        'amazon.it',
        'ebay.it',
        'wikipedia.org'
    ]);

    public static isBlacklisted(domain: string): boolean {
        // Simple domain extraction check
        return this.domains.has(domain) || Array.from(this.domains).some(d => domain.endsWith('.' + d));
    }
}
