// Shared routing remains neutral: these arrays define the escalation order only.
//
// ⚡ COST ROUTING STRATEGY:
//   Free providers first → then ORACLE (free Google via Crawl4AI) → then paid APIs as fallback.
//   ORACLE-SERP-1 is placed BEFORE Serper/Exa/Tavily to avoid burning paid credits
//   on queries that Crawl4AI can resolve for free via Google IT.
//   Serper/Exa/Tavily are high-reliability fallbacks for when Oracle is rate-limited.
export const SERP_PROVIDER_ORDER = [
    'DNS-MX-MINING-0',      // Free: DNS/MX record mining
    'CRTSH-API-1',          // Free: Certificate Transparency logs
    'SERPER-API-1',         // 💰 PAID: Serper (Rock-solid primary SERP)
    'DDG-LITE-1',           // Free: DuckDuckGo HTML scraping (Fallback)
    'BING-HTML-1',          // Free: Bing HTML scraping via proxy (Fallback)
    'EXA-API-2',            // 💰 PAID: Exa (semantic search fallback)
    'PERPLEXITY-API-4',     // 💰 PAID: Perplexity (last resort)
] as const;

export const HTTP_PROVIDER_ORDER = [
    // Ordered by escalation strategy, not pure vendor unit price:
    // preserve cheap raw fetch first, then premium unlocker.
    'HTTP-DIRECT-1',
    'FIRECRAWL-SCRAPE-3',
    'HTTP-BRIGHTDATA-4',
    'ORACLE-CRAWL4AI-5',
] as const;
