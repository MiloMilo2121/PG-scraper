
import * as dns from 'dns';
import { promisify } from 'util';

const resolve = promisify(dns.resolve);

export class DnsUtils {
    public static async resolve(domain: string): Promise<boolean> {
        try {
            await resolve(domain);
            return true;
        } catch (e) {
            return false;
        }
    }

    public static async checkMX(domain: string): Promise<boolean> {
        try {
            const mx = await promisify(dns.resolveMx)(domain);
            return mx.length > 0;
        } catch (e) {
            return false;
        }
    }
}
