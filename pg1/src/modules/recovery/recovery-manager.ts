import { ClusterManager } from '../browser/cluster';
import { PuppeteerSearchProvider } from '../miner/puppeteer-provider';
import { OpenAIVerifier } from '../verifier/openai-verifier'; // Should be updated to export OpenAIVerifier
import { logger } from '../observability';
import OpenAI from 'openai';

interface CompanyData {
    company_name: string;
    city: string;
    address?: string;
    phone?: string;
    industry?: string;
    status: string;
    site_url_official?: string;
    decision_reason?: string;
    confidence?: number;
    search_date?: string;
    [key: string]: any;
}

export class RecoveryManager {
    private searcher: PuppeteerSearchProvider;
    private openai: OpenAI;

    constructor() {
        this.searcher = new PuppeteerSearchProvider();
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }

    async init() {
        await ClusterManager.getInstance();
    }

    async close() {
        await ClusterManager.close();
    }

    /**
     * Phase 2: AI Direct Recovery
     * Ask LLM if it knows the website directly.
     */
    async phaseAiDirect(company: CompanyData): Promise<boolean> {
        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{
                    role: 'user',
                    content: `Devo trovare il sito web ufficiale di un'azienda italiana.

Azienda: ${company.company_name}
Città: ${company.city}
${company.industry ? `Settore: ${company.industry}` : ''}

Rispondi SOLO con un JSON:
- Se trovi il sito: {"website": "https://www.esempio.it", "confidence": 85, "reason": "..."}
- Altrimenti: {"website": null}
`
                }],
                temperature: 0.1,
                max_tokens: 150
            });

            const content = response.choices[0]?.message?.content || '';
            const match = content.match(/\{[\s\S]*\}/);
            if (match) {
                const res = JSON.parse(match[0]);
                if (res.website) {
                    company.status = 'AI_RECOVERED';
                    company.site_url_official = res.website;
                    company.decision_reason = `AI Direct: ${res.reason}`;
                    company.confidence = res.confidence || 80;
                    return true;
                }
            }
        } catch (e) {
            logger.log('error', `AI Direct failed for ${company.company_name}`, e);
        }
        return false;
    }

    /**
     * Phase 3: Deep Search
     * Uses broader queries + AI Verification
     */
    async phaseDeepSearch(company: CompanyData): Promise<boolean> {
        const queries = [
            `"${company.company_name}" "${company.city}" sito ufficiale`,
            `"${company.company_name}" ${company.industry || ''} ${company.city}`,
            `"${company.company_name}" contatti`
        ];

        for (const query of queries) {
            const results = await this.searcher.search(query, 5);
            for (const res of results) {
                if (res.url.includes('facebook') || res.url.includes('instagram')) continue;

                const verification = await OpenAIVerifier.verify(
                    {
                        company_name: company.company_name,
                        city: company.city,
                        address: company.address,
                        industry: company.industry,
                        phone: company.phone
                    },
                    { url: res.url, page_title: res.title, content_snippet: res.snippet }
                );

                if (verification.is_match && verification.confidence >= 70) {
                    company.status = 'DEEP_RECOVERED';
                    company.site_url_official = res.url;
                    company.decision_reason = `Deep Search: ${verification.reason}`;
                    company.confidence = verification.confidence;
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Phase 4: Sherlock Mode
     * Phone, Social, Portals + Loose AI Match
     */
    async phaseSherlock(company: CompanyData): Promise<boolean> {
        const queries = [];
        if (company.phone && company.phone.length > 5) queries.push(`"${company.phone}"`);
        queries.push(`site:facebook.com "${company.company_name}" ${company.city}`);
        queries.push(`site:instagram.com "${company.company_name}" ${company.city}`);
        queries.push(`"${company.company_name}" ${company.city} telefono`);

        for (const query of queries) {
            const results = await this.searcher.search(query, 3);
            for (const res of results) {
                const verification = await OpenAIVerifier.verify(
                    {
                        company_name: company.company_name,
                        city: company.city,
                        address: company.address,
                        industry: company.industry,
                        phone: company.phone
                    },
                    { url: res.url, page_title: res.title, content_snippet: res.snippet },
                    { looseMatch: true }
                );

                if (verification.is_match && verification.confidence >= 60) {
                    company.status = 'SHERLOCK_RECOVERED';
                    company.site_url_official = res.url;
                    company.decision_reason = `Sherlock: ${verification.reason}`;
                    company.confidence = verification.confidence;
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Phase 5: Final Reason Analysis
     * Determine why it's missing (Closed? No web?)
     */
    async phaseFinalAnalysis(company: CompanyData): Promise<void> {
        try {
            const query = `stato attività "${company.company_name}" ${company.city}`;
            const results = await this.searcher.search(query, 3);
            const snippets = results.map(r => r.snippet).join('\n');

            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{
                    role: 'user',
                    content: `Analizza questi risultati di ricerca per l'azienda "${company.company_name}" a ${company.city}.
Determina perché non ha un sito web.
Risultati ricerca:
${snippets}

Scegli una motivazione tra:
1. "FALLITA_CHIUSA" (se ci sono messaggi di chiusura/liquidazione)
2. "SOLO_OFFLINE" (se ci sono elenchi telefonici ma nessun sito/social)
3. "NON_TROVATA" (se non c'è quasi nulla)

Rispondi SOLO con la stringa della motivazione.`
                }],
                temperature: 0.1
            });

            const reason = response.choices[0]?.message?.content?.trim() || 'NON_TROVATA';
            company.status = 'FINAL_FAIL'; // Keep distinct from NO_DOMAIN_FOUND
            company.decision_reason = `Analysis: ${reason}`;
            company.site_url_official = '';
            company.confidence = 0;

        } catch (e) {
            company.status = 'FINAL_FAIL';
            company.decision_reason = 'Analysis: NON_TROVATA (Error)';
        }
    }
}
