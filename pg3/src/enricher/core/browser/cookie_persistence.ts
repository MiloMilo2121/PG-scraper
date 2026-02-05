/**
 * 🍪 COOKIE PERSISTENCE MANAGER
 * Task 17: Redis-backed cookie storage for session persistence
 * 
 * Features:
 * - Save cookies per domain to Redis
 * - Inject cookies on page load
 * - Auto-expire stale cookies
 */

import { Page, Cookie } from 'puppeteer';
import { Logger } from '../../utils/logger';

// Cookie storage (using in-memory map as fallback, Redis integration TODO)
const cookieStore: Map<string, Cookie[]> = new Map();

export class CookiePersistence {
    /**
     * 💾 Save cookies for a domain
     */
    static async saveCookies(page: Page, domain?: string): Promise<void> {
        try {
            const cookies = await page.cookies();
            if (cookies.length === 0) return;

            // Group by domain
            const domainCookies = new Map<string, Cookie[]>();
            for (const cookie of cookies) {
                const cookieDomain = cookie.domain.replace(/^\./, '');
                if (!domainCookies.has(cookieDomain)) {
                    domainCookies.set(cookieDomain, []);
                }
                domainCookies.get(cookieDomain)!.push(cookie);
            }

            // Store each domain's cookies
            for (const [dom, cooks] of domainCookies) {
                const key = `cookies:${dom}`;
                cookieStore.set(key, cooks);
            }

            Logger.info(`🍪 Saved ${cookies.length} cookies for ${domainCookies.size} domains`);
        } catch (e) {
            Logger.warn('Failed to save cookies', { error: e as Error });
        }
    }

    /**
     * 📥 Load cookies for a URL
     */
    static async loadCookies(page: Page, url: string): Promise<boolean> {
        try {
            const domain = new URL(url).hostname.replace('www.', '');
            const key = `cookies:${domain}`;
            const cookies = cookieStore.get(key);

            if (!cookies || cookies.length === 0) {
                return false;
            }

            // Filter expired cookies
            const now = Date.now() / 1000;
            const validCookies = cookies.filter(c => !c.expires || c.expires > now);

            if (validCookies.length > 0) {
                await page.setCookie(...validCookies);
                Logger.info(`🍪 Injected ${validCookies.length} cookies for ${domain}`);
                return true;
            }

            return false;
        } catch (e) {
            Logger.warn('Failed to load cookies', { error: e as Error });
            return false;
        }
    }

    /**
     * 🧹 Clear cookies for a domain
     */
    static clearCookies(domain: string): void {
        const key = `cookies:${domain}`;
        cookieStore.delete(key);
    }

    /**
     * 🧹 Clear all cookies
     */
    static clearAll(): void {
        cookieStore.clear();
    }

    /**
     * 📊 Get cookie statistics
     */
    static getStats(): { domains: number; totalCookies: number } {
        let totalCookies = 0;
        for (const cookies of cookieStore.values()) {
            totalCookies += cookies.length;
        }
        return {
            domains: cookieStore.size,
            totalCookies,
        };
    }
}

/**
 * 🔄 Middleware to auto-load/save cookies
 */
export async function withCookies<T>(
    page: Page,
    url: string,
    action: () => Promise<T>
): Promise<T> {
    // Load existing cookies before navigation
    await CookiePersistence.loadCookies(page, url);

    // Execute action
    const result = await action();

    // Save cookies after action
    await CookiePersistence.saveCookies(page);

    return result;
}
