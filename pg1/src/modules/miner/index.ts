import { NormalizedEntity, Candidate, SearchProvider, SearchResult } from '../../types';
import { URL } from 'url';
import { Scorer } from '../scorer'; // for ranking if needed, or just ranking logic here
import { getConfig } from '../../config';

export class CandidateMiner {
    private provider: SearchProvider;
    private _blacklist: Set<string> | null = null;

    constructor(provider: SearchProvider) {
        this.provider = provider;
    }

    // Load blacklist from config (unified source of truth)
    private get BLACKLIST(): Set<string> {
        if (!this._blacklist) {
            const config = getConfig();
            this._blacklist = new Set([
                ...config.lists.directory_domains,
                ...config.lists.social_domains,
                ...config.lists.marketplace_domains
            ]);
        }
        return this._blacklist;
    }

    async mine(entity: NormalizedEntity): Promise<Candidate[]> {
        const initialQueries = this.generateQueries(entity);
        let candidates: Candidate[] = [];
        const seenUrls = new Set<string>();

        // Phase 1: Standard Queries
        await this.runSearchPhase(initialQueries, candidates, seenUrls);

        // Phase 2: Fallback if no valid candidates found search for "sito ufficiale"
        // or just strict name+city if not tried
        // We consider "valid" candidates slightly loosely here, but if we have 0, we definitely retry.
        if (candidates.length === 0) {
            const fallbackQueries = [
                `"${entity.company_name}" ${entity.city} sito ufficiale`,
                `${entity.company_name} ${entity.city} website`
            ];
            console.log(`[Miner] No candidates found, trying fallback queries: ${fallbackQueries.join(', ')}`);
            await this.runSearchPhase(fallbackQueries, candidates, seenUrls);
        }

        return candidates;
    }

    private async runSearchPhase(queries: string[], candidates: Candidate[], seenUrls: Set<string>) {
        for (const q of queries) {
            try {
                const results = await this.provider.search(q, 5); // top 5 per query

                for (const res of results) {
                    if (seenUrls.has(res.url)) continue;
                    seenUrls.add(res.url);

                    try {
                        const root = new URL(res.url).hostname.replace(/^www\./, '');

                        // Blacklist check
                        // Check if root ends with any blacklisted domain (to handle subdomains like shop.paginegialle.it)
                        let isBlacklisted = false;
                        for (const bad of this.BLACKLIST) {
                            if (root === bad || root.endsWith('.' + bad)) {
                                isBlacklisted = true;
                                break;
                            }
                        }

                        if (isBlacklisted) {
                            // console.log(`[Miner] Skipping blacklisted: ${root}`);
                            continue;
                        }

                        candidates.push({
                            root_domain: root,
                            source_url: res.url,
                            rank: candidates.length + 1,
                            provider: this.provider.name,
                            snippet: res.snippet,
                            title: res.title
                        });
                    } catch (e) {
                        // invalid url
                    }
                }
            } catch (e) {
                console.error(`Search failed for query: ${q}`, e);
            }
        }
    }

    generateQueries(entity: NormalizedEntity): string[] {
        // SIMPLIFIED: Just use "Company Name" City
        // This is the most natural search query a human would use
        const queries: string[] = [];

        if (entity.company_name && entity.city) {
            // Primary query: Exact company name + city
            queries.push(`"${entity.company_name}" ${entity.city}`);
        } else if (entity.company_name) {
            // Fallback if no city
            queries.push(`"${entity.company_name}"`);
        }

        return queries;
    }
}
