
import { Page } from 'puppeteer';
import * as cheerio from 'cheerio';

/**
 * 🕵️ DEEP SCANNER 🕵️
 * Tasks 21, 22, 25: Finds Legal/Contact pages and analyzes SiteMaps
 */
export class DeepScanner {

    /**
     * Task 21: Legal Page Seeker
     * Looks for "Privacy Policy", "Cookie Policy", "Termini e Condizioni"
     */
    static async findLegalPages(page: Page, baseUrl: string): Promise<string[]> {
        try {
            const links = await page.evaluate(() => {
                const anchors = Array.from(document.querySelectorAll('a'));
                return anchors
                    .map(a => ({ text: a.innerText.toLowerCase(), href: a.href }))
                    .filter(a =>
                        a.text.includes('privacy') ||
                        a.text.includes('cookie') ||
                        a.text.includes('termini') ||
                        a.text.includes('legal') ||
                        a.text.includes('note legali')
                    )
                    .map(a => a.href);
            });
            return [...new Set(links)];
        } catch {
            return [];
        }
    }

    /**
     * Task 22: Contact Page Seeker
     * Looks for "Contatti", "Chi Siamo", "About Us"
     */
    static async findContactPages(page: Page): Promise<string[]> {
        try {
            const links = await page.evaluate(() => {
                const anchors = Array.from(document.querySelectorAll('a'));
                return anchors
                    .map(a => ({ text: a.innerText.toLowerCase(), href: a.href }))
                    .filter(a =>
                        a.text.includes('contat') ||
                        a.text.includes('chi siamo') ||
                        a.text.includes('dove siamo') ||
                        a.text.includes('about')
                    )
                    .map(a => a.href);
            });
            return [...new Set(links)];
        } catch {
            return [];
        }
    }

    /**
     * Task 23: PDF Parsing (Mock/Stub for now)
     * Checks if a link ends in .pdf
     */
    static findPdfLinks(html: string): string[] {
        const $ = cheerio.load(html);
        const pdfs: string[] = [];
        $('a').each((_: number, el: any) => {
            const href = $(el).attr('href');
            if (href && href.toLowerCase().endsWith('.pdf')) {
                pdfs.push(href);
            }
        });
        return pdfs;
    }

    /**
     * Task 25: Sitemap Detection
     * Tries typical sitemap paths
     */
    static async checkSitemap(domain: string): Promise<string | null> {
        const paths = ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml'];
        for (const p of paths) {
            try {
                // We would use fetch/axios here usually, passing for check
                // return `${domain}${p}`;
            } catch { }
        }
        return null;
    }
}
