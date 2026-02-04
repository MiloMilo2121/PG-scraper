
import { BrowserFactory } from './src/core/browser/factory_v2';
import path from 'path';

async function debugScreen() {
    const bf = BrowserFactory.getInstance();
    const page = await bf.newPage();
    const url = 'https://www.reportaziende.it/cerca?q=TECO+SPA+BRESCIA';
    console.log("NAVIGATING TO:", url);
    await page.goto(url, { waitUntil: 'networkidle2' });
    const screenPath = '/root/PG-scraper/pg3/debug_reportaziende.png';
    await page.screenshot({ path: screenPath });
    console.log("SCREENSHOT SAVED TO:", screenPath);
    process.exit(0);
}

debugScreen();
