// Shared routing remains neutral: these arrays define the escalation order only.
export const SERP_PROVIDER_ORDER = [
    'DNS-MX-MINING-0',
    'CRTSH-API-1',
    'DDG-LITE-1',
    'BING-HTML-1',
    'SEARXNG-NET-1',
    'SERPER-API-1',
    'EXA-API-2',
    'TAVILY-API-2',
    'ORACLE-SERP-1',
    'PERPLEXITY-API-4',
] as const;

export const HTTP_PROVIDER_ORDER = [
    // Ordered by escalation strategy, not pure vendor unit price:
    // preserve cheap raw fetch first, then premium unlocker.
    'HTTP-DIRECT-1',
    'FIRECRAWL-SCRAPE-3',
    'HTTP-BRIGHTDATA-4',
    'ORACLE-CRAWL4AI-5',
] as const;
