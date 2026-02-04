
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
    const browser = await puppeteer.launch({ headless: true }); // Using 'new' headless
    const page = await browser.newPage();
    const url = 'https://www.paginegialle.it/ricerca/meccatronica/Verona';

    console.log(`Testing PG access: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const title = await page.title();
    console.log(`Title: ${title}`);

    // Check for results
    const count = await page.evaluate(() => {
        return document.querySelectorAll('.search-itm').length;
    });
    console.log(`Found items: ${count}`);

    await browser.close();
})();
