
import { BrowserFactory } from '../browser/factory_v2';
import { CompanyInput } from '../company_types';
import { Logger } from '../../utils/logger';
import OpenAI from 'openai';

interface Contact {
    name: string;
    role: string;
    email?: string;
    linkedin?: string;
    score: number;
}

/**
 * 👤 CONTACT SERVICE
 * Finds decision makers via LinkedIn and Company Website.
 */
export class ContactService {
    private browserFactory: BrowserFactory;
    private openai: OpenAI;
    constructor(apiKey?: string) {
        this.browserFactory = BrowserFactory.getInstance();
        const key = apiKey || process.env.OPENAI_API_KEY || '';
        this.openai = new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true });
    }

    async enrichContacts(company: CompanyInput, domain: string): Promise<Contact[]> {
        Logger.info(`   [Contact] Searching contacts for: ${company.company_name} (${domain})`);

        const contacts: Contact[] = [];

        // 1. Scrape "Team" or "About" page
        if (company.website) {
            const webContacts = await this.scrapeTeamPage(company.website);
            contacts.push(...webContacts);
        }

        // 2. LinkedIn Search (Google Dork)
        if (contacts.length === 0) {
            const liContacts = await this.searchLinkedInPeople(company.company_name);
            contacts.push(...liContacts);
        }

        // 3. Email Permutation (if name found but no email)
        for (const c of contacts) {
            if (!c.email && domain) {
                // Generate simple permutations (we don't verify here, verification is Phase 4)
                const first = c.name.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '');
                const last = c.name.split(' ').slice(1).join('').toLowerCase().replace(/[^a-z]/g, '');
                if (first && last) {
                    // Try most common format: first.last@domain
                    c.email = `${first}.${last}@${domain}`;
                }
            }
        }

        return contacts;
    }

    private async scrapeTeamPage(url: string): Promise<Contact[]> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            await page.goto(url, { waitUntil: 'domcontentloaded' });

            // Heuristic to find Team link
            const teamUrl = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                for (const link of links) {
                    const t = link.innerText.toLowerCase();
                    if ((t.includes('team') || t.includes('chi siamo') || t.includes('about')) && link.href) {
                        return link.href;
                    }
                }
                return null;
            });

            if (teamUrl) {
                await page.goto(teamUrl, { waitUntil: 'domcontentloaded' });
            }

            const text = await page.evaluate(() => document.body.innerText.substring(0, 5000));

            // Extract Names via AI
            const completion = await this.openai.chat.completions.create({
                messages: [{
                    role: "user",
                    content: `Extract names and roles of key people (CEO, Founder, Director only) from this text for "${url}". 
                    Return JSON array: [{"name": "...", "role": "..."}]. If none, return [].
                    Text:
                    ${text}`
                }],
                model: "gpt-4o",
            });

            const raw = completion.choices[0].message.content?.replace(/```json/g, '').replace(/```/g, '').trim();
            if (raw) {
                const parsed = JSON.parse(raw);
                return parsed.map((p: any) => ({
                    name: p.name,
                    role: p.role,
                    score: 50
                }));
            }

        } catch (e) { }
        finally { if (page) await this.browserFactory.closePage(page); }
        return [];
    }

    private async searchLinkedInPeople(companyName: string): Promise<Contact[]> {
        let page;
        try {
            page = await this.browserFactory.newPage();
            // Google Dork for LinkedIn
            const q = `site:linkedin.com/in/ "${companyName}" (CEO OR Founder OR Titolare OR "Amministratore Delegato")`;
            await page.goto(`https://www.google.com/search?q=${encodeURIComponent(q)}`, { waitUntil: 'domcontentloaded' });

            const results = await page.evaluate(() => {
                const items = Array.from(document.querySelectorAll('.g, .b_algo'));
                return items.slice(0, 3).map(i => {
                    const title = (i.querySelector('h3') as HTMLElement)?.innerText || '';
                    const link = (i.querySelector('a') as HTMLAnchorElement)?.href || '';
                    // Title usually: "Name - Role - Company"
                    const parts = title.split(/[-|–]/);
                    if (parts.length >= 2) {
                        return {
                            name: parts[0].trim(),
                            role: parts[1].trim(),
                            linkedin: link,
                            score: 80
                        };
                    }
                    return null;
                }).filter(x => x !== null) as Contact[];
            });
            return results;
        } catch { return []; }
        finally { if (page) await this.browserFactory.closePage(page); }
    }
}
