import { BrowserFactory } from './src/core/browser/factory_v2';
import { Logger } from './src/utils/logger';

async function testReportAziende() {
    Logger.info('🕵️ Testing ReportAziende.it Scraper...');

    // Use a separate profile for this test to avoid conflicts
    const factory = BrowserFactory.getInstance('./temp_profiles/test_reportaziende');
    let page;

    try {
        page = await factory.newPage();

        // 1. Visit Homepage
        Logger.info('Navigating to ReportAziende search...');
        // Usually these searches are simple GET queries or need input
        // Let's try a direct search query if possible, or just the home
        const query = 'Ferrari Spa';
        const searchUrl = `https://www.reportaziende.it/ricerca_aziende?company=${encodeURIComponent(query)}`;

        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        Logger.info('Page loaded. Checking title...');
        const title = await page.title();
        Logger.info(`Title: ${title}`);

        // Screenshot for debug
        await page.screenshot({ path: 'reportaziende_test.png' });

        // 2. Extract Results
        // ReportAziende usually lists results in a table or divs
        // Let's try to grab the first link
        const firstResult = await page.evaluate(() => {
            // This selector is a guess, will need to refine based on actual structure
            // Looking for generic links inside main content
            const links = Array.from(document.querySelectorAll('a'));
            // Filter for links that look like company pages (often /ciap/...)
            const companyLink = links.find(l => l.href.includes('reportaziende.it/') && !l.href.includes('ricerca'));
            return companyLink ? companyLink.href : null;
        });

        if (firstResult) {
            Logger.info(`Found Company Page: ${firstResult}`);
            await page.goto(firstResult, { waitUntil: 'domcontentloaded' });

            // 3. Extract Details (VAT, Revenue)
            const details = await page.evaluate(() => {
                const text = document.body.innerText;
                const pivaCoords = text.match(/Partita IVA\s*:\s*(\d+)/i);
                const revenueCoords = text.match(/Fatturato\s*(\d{4})?\s*:\s*([\d\.]+)/i);
                return {
                    piva: pivaCoords ? pivaCoords[1] : 'Not Found',
                    revenue: revenueCoords ? revenueCoords[0] : 'Not Found',
                    raw_text_sample: text.substring(0, 500).replace(/\n/g, ' ')
                };
            });

            Logger.info('Extracted Details:');
            console.log(JSON.stringify(details, null, 2));

        } else {
            Logger.warn('No company link found in search results.');
        }

    } catch (error) {
        Logger.error('Scraping Failed:', error);
    } finally {
        await factory.close();
    }
}

testReportAziende();
