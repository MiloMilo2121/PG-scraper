import { Candidate } from '../../types';
import { getConfig } from '../../config';

export class CandidateDeduper {

    static dedupe(candidates: Candidate[]): Candidate[] {
        const config = getConfig();
        const unique = new Map<string, Candidate>();

        // Sort by rank ascending (lower is better)
        candidates.sort((a, b) => a.rank - b.rank);

        for (const c of candidates) {
            if (!unique.has(c.root_domain)) {
                unique.set(c.root_domain, c);
            }
        }

        // Limit to max candidates per row
        return Array.from(unique.values()).slice(0, config.crawl_budget.max_candidates_per_row);
    }

    static planUrls(candidate: Candidate, foundLinks: string[] = []): string[] {
        const config = getConfig();
        const root = candidate.root_domain;
        const protocol = 'http://'; // will be upgraded to https by fetcher if possible or we assume https first
        // Actually Fetcher handles strict protocol, but here we just need paths.

        // Base URLs
        const urls = new Set<string>();
        urls.add(candidate.source_url); // The one we found
        urls.add(`https://${root}`);
        urls.add(`http://${root}`); // Fallback

        // If we have foundLinks (e.g. from seed or previous fetch), prioritize contact pages
        // This part is tricky: URL Planner usually runs BEFORE full crawl, but might run iteratively?
        // For MVP, we plan the initial fetch.

        // We prioritize:
        // 1. Source URL (might be deep link)
        // 2. Homepage (https)

        // If we are in an iterative loop (which we are not explicitly yet), we would add more.
        // We'll stick to returning the prioritized list to try.
        // The Fetcher/Orchestrator will handle the loop using max_pages_per_domain.

        return Array.from(urls);
    }
}
