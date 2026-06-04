import { ScraperClient } from './src/enricher/utils/scraper_client';
import fs from 'fs';
import { initializeRuntimeEnvironment } from './src/shared-runtime/config/runtime_bootstrap';
import { initializeRuntimeConfig } from './src/shared-runtime/config/runtime_config';

async function fetchSites() {
    initializeRuntimeEnvironment();
    initializeRuntimeConfig();

    const targets = [
        "https://www.registroaziende.it/azienda/caldiero-case-snc-di-corsi-eros-e-maistri-luigi-caldiero",
        "https://fatturatoitalia.it/azienda/1937561205/elg-immobiliare-srl",
        "https://wogha.com/company/agenzia-zugliani-di-zugliani-andrea-via-padovana-148b-arcole-37040-vr_it-1-vr242956"
    ];

    for (let i = 0; i < targets.length; i++) {
        const url = targets[i];
        console.log(`Fetching ${url}...`);
        try {
            const res = await ScraperClient.fetchHtml(url, { mode: 'brightdata', timeoutMs: 30000 });
            if (res.data) {
                fs.writeFileSync(`registry_${i}.html`, res.data);
                console.log(`Saved registry_${i}.html`);
            }
        } catch (err) {
            console.log(`Failed to fetch ${url}`, err);
        }
    }
}

fetchSites();
