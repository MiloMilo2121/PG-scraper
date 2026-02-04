import dns from 'dns';
import { promisify } from 'util';
import { fetcher } from '../fetcher';

const resolveNs = promisify(dns.resolveNs);
const resolveA = promisify(dns.resolve4);
const resolveCname = promisify(dns.resolveCname);

export interface ValidityResult {
    dns_ok: boolean;
    http_ok: boolean;
    final_url?: string;
}

export class ValidityChecker {

    static async check(domain: string): Promise<ValidityResult> {
        // 1. DNS Check
        let dnsOk = false;
        try {
            await Promise.any([
                resolveA(domain),
                resolveNs(domain),
                resolveCname(domain)
            ]);
            dnsOk = true;
        } catch (e) {
            // try adding www if missing
            if (!domain.startsWith('www.')) {
                try {
                    await resolveA('www.' + domain);
                    dnsOk = true;
                } catch (e2) {
                    dnsOk = false;
                }
            }
        }

        if (!dnsOk) {
            return { dns_ok: false, http_ok: false };
        }

        // 2. HTTP Check
        // Try HTTPS first, then HTTP
        // We can use the fetcher, but we just want a HEAD or quick GET
        try {
            const res = await fetcher.fetch(`https://${domain}`, true);
            if (res.status < 400) {
                return { dns_ok: true, http_ok: true, final_url: res.finalUrl };
            }
        } catch (e) {
            // try http
            try {
                const res = await fetcher.fetch(`http://${domain}`, true);
                if (res.status < 400) {
                    return { dns_ok: true, http_ok: true, final_url: res.finalUrl };
                }
            } catch (e2) {
                // fail
            }
        }

        return { dns_ok: true, http_ok: false };
    }
}
