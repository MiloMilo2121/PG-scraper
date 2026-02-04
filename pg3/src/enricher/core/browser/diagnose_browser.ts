
import { BrowserFactory } from './factory_v2';
import { Logger } from '../../utils/logger';

async function main() {
    console.log('--- BROWSER DIAGNOSTIC START ---');
    try {
        const factory = BrowserFactory.getInstance();
        console.log('[1] Factory Instance obtained.');

        console.log('[2] Launching Browser...');
        const browser = await factory.launch();
        console.log(`[3] Browser launched. Connected: ${browser.isConnected()}`);
        console.log(`[3b] Version: ${await browser.version()}`);

        console.log('[4] Opening Page...');
        const page = await factory.newPage();
        console.log('[5] Page opened.');

        console.log('[6] Navigating to example.com...');
        await page.goto('https://example.com');
        const title = await page.title();
        console.log(`[7] Page Title: ${title}`);

        await factory.closePage(page);
        await factory.close();
        console.log('[8] Cleanup done. SUCCESS.');

    } catch (e) {
        console.error('❌ FATAL ERROR:', e);
    }
    console.log('--- BROWSER DIAGNOSTIC END ---');
}

main().catch(console.error);
