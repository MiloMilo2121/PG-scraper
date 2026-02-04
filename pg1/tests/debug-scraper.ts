
import { PuppeteerWrapper } from '../src/modules/browser';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

async function runDebug() {
    // A known simple query
    const query = 'Wonder Truss Guardamiglio contatti';
    const q = encodeURIComponent(query);
    // Switch to Bing
    const url = `https://www.bing.com/search?q=${q}`;

    console.log(`fetching ${url}...`);

    try {
        const res = await PuppeteerWrapper.fetch(url);
        console.log(`Status: ${res.status}`);
        console.log(`Content length: ${res.content.length}`);

        const dumpPath = path.resolve(__dirname, '../debug_google.html');
        fs.writeFileSync(dumpPath, res.content);
        console.log(`Saved HTML to ${dumpPath}`);

        const $ = cheerio.load(res.content);
        // Try to find the consent button info or title
        console.log('Title:', $('title').text());
        console.log('Body Text Snippet:', $('body').text().substring(0, 200).replace(/\s+/g, ' '));

        // Check for common consent text
        if ($('body').text().includes('Prima di continuare')) {
            console.log('WARNING: Detected Google Consent Page!');
        }

    } catch (e) {
        console.error(e);
    }

    await PuppeteerWrapper.close();
}

runDebug();
