/**
 * 🔬 DIAGNOSTIC: Isolate which step in BrowserFactory.newPage() kills the frame.
 * Run: npx ts-node src/scripts/diag_browser.ts
 */
import puppeteer from 'puppeteer';

async function main() {
    console.log('=== BROWSER DIAGNOSTIC ===');

    // Step 1: Launch browser with minimal args (same as factory_v2)
    console.log('[1] Launching browser...');
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--ignore-certificate-errors',
        ],
        defaultViewport: null,
    } as any);
    console.log('[1] ✅ Browser launched');

    // Step 2: Create a new page
    console.log('[2] Creating new page...');
    const page = await browser.newPage();
    console.log(`[2] ✅ Page created.`);

    // Step 3: Test basic navigation BEFORE any customization
    console.log('[3] Testing goto BEFORE customization...');
    try {
        await page.goto('https://www.paginegialle.it', { waitUntil: 'domcontentloaded', timeout: 15000 });
        const title = await page.title();
        console.log(`[3] ✅ Navigation SUCCESS. Title: "${title}"`);
    } catch (e) {
        console.error(`[3] ❌ Navigation FAILED: ${(e as Error).message}`);
    }

    // Step 4: Test setUserAgent
    console.log('[4] Setting User Agent...');
    try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        console.log('[4] ✅ setUserAgent OK');
    } catch (e) {
        console.error(`[4] ❌ setUserAgent FAILED: ${(e as Error).message}`);
    }

    // Step 5: Test setViewport
    console.log('[5] Setting Viewport...');
    try {
        await page.setViewport({ width: 1920, height: 1080 });
        console.log('[5] ✅ setViewport OK');
    } catch (e) {
        console.error(`[5] ❌ setViewport FAILED: ${(e as Error).message}`);
    }

    // Step 6: Test evaluateOnNewDocument
    console.log('[6] evaluateOnNewDocument...');
    try {
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });
        console.log('[6] ✅ evaluateOnNewDocument OK');
    } catch (e) {
        console.error(`[6] ❌ evaluateOnNewDocument FAILED: ${(e as Error).message}`);
    }

    // Step 7: Test goto AFTER customization
    console.log('[7] Testing goto AFTER customization...');
    try {
        await page.goto('https://www.paginegialle.it/ricerca/Officine+meccaniche/MI', { waitUntil: 'domcontentloaded', timeout: 15000 });
        const title = await page.title();
        console.log(`[7] ✅ Navigation SUCCESS. Title: "${title}"`);
    } catch (e) {
        console.error(`[7] ❌ Navigation FAILED: ${(e as Error).message}`);
    }

    // Step 8: Test page.evaluate
    console.log('[8] Testing page.evaluate...');
    try {
        const result = await page.evaluate(() => document.querySelectorAll('.search-itm').length);
        console.log(`[8] ✅ evaluate OK. Found ${result} search items`);
    } catch (e) {
        console.error(`[8] ❌ evaluate FAILED: ${(e as Error).message}`);
    }

    await browser.close();
    console.log('=== DIAGNOSTIC DONE ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
