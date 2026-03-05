import { chromium } from 'playwright';

async function testPG() {
    console.log("Starting PG test...");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Test the exact URL that was failing
    const url = 'https://www.paginegialle.it/ricerca/Aziende%20agricole/MN';
    console.log("Navigating to:", url);
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    console.log("Evaluating items...");

    const items = await page.evaluate(() => {
        // List of multiple potential selectors just to debug
        const potentialClasses = [
            '.search-itm',
            '.listing-item',
            '[data-type="azienda"]',
            '.result-item',
            '.box-results',
            '.vcard'
        ];

        const findings: any = {};
        for (const cls of potentialClasses) {
            findings[cls] = document.querySelectorAll(cls).length;
        }

        return findings;
    });

    console.log("Selector hits:", items);

    await browser.close();
}

testPG().catch(console.error);
