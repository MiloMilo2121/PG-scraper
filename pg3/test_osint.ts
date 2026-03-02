import { SearXNGProvider } from './src/enricher/core/discovery/searxng_provider';
import * as fs from 'fs';

async function run() {
    console.log("\n=== Testing SearXNGProvider HTML Dumper ===");
    const sxng = new SearXNGProvider();

    // Patch temporally the console.log inside searxng_provider.ts to save raw html
    try {
        const sxngRes = await sxng.search("pizzeria bella napoli torino sito web", 5);
        console.log(`[SXNG] Found ${sxngRes.length} results.`);
        console.log(JSON.stringify(sxngRes, null, 2));
    } catch (e: any) {
        console.error(`[SXNG] Error: ${e.message}`);
    }
}
run();
