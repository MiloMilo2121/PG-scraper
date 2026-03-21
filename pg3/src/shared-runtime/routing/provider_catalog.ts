export const SERP_PROVIDER_ORDER = [
    'SERPER-API-1',
    'BRAVE-API-1',
    'TAVILY-API-2',
    'DNS-MX-MINING-0',
    'CRTSH-API-1',
    'DDG-LITE-1',
    'BRAVE-HTML-1',
    'BING-HTML-1',
    'SEARXNG-NET-1',
    'PERPLEXITY-API-4',
] as const;

export const HTTP_PROVIDER_ORDER = [
    // Ordered by escalation strategy, not pure vendor unit price:
    // preserve cheap raw fetch first, then premium unlocker.
    'HTTP-DIRECT-1',
    'HTTP-BRIGHTDATA-4',
    'ORACLE-CRAWL4AI-5',
] as const;
