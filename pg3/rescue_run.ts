
import * as fs from 'fs';
import * as path from 'path';
import { createObjectCsvWriter } from 'csv-writer';
import puppeteer from 'puppeteer';

// --- CONFIG ---
const OUTPUT_DIR = 'output/campaigns';
const KEYWORDS = ["meccatronica", "automazione industriale", "robotica", "officina meccanica", "costruzioni meccaniche", "impianti industriali"];
const CITIES = ["Verona", "Padova", "Brescia"];
const MAX_PAGES = 3;

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function run() {
    console.log("🚀 EMERGENCY RESCUE RUN STARTING...");
    const browser = await puppeteer.launch({ headless: false, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    const seen = new Set<string>();

    for (const city of CITIES) {
        const file = path.join(OUTPUT_DIR, `RESCUE_${city}_${Date.now()}.csv`);
        const csvWriter = createObjectCsvWriter({
            path: file,
            header: [
                { id: 'company_name', title: 'company_name' },
                { id: 'city', title: 'city' },
                { id: 'address', title: 'address' },
                { id: 'phone', title: 'phone' },
                { id: 'website', title: 'website' },
                { id: 'category', title: 'category' }
            ]
        });

        for (const kw of KEYWORDS) {
            console.log(`🔎 [${city}] Searching: ${kw}`);

            // --- PG ---
            try {
                for (let p = 1; p <= MAX_PAGES; p++) {
                    const url = `https://www.paginegialle.it/ricerca/${kw.replace(/ /g, '%20')}/${city}/p-${p}`;
                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

                    const results = await page.evaluate((cityName, category) => {
                        return Array.from(document.querySelectorAll('.search-itm')).map(item => {
                            const name = item.querySelector('.search-itm__rag')?.textContent?.trim();
                            const addr = item.querySelector('.search-itm__adr')?.textContent?.trim();
                            const phone = item.querySelector('.search-itm__phone')?.textContent?.trim();
                            const web = item.querySelector('.search-itm__url')?.getAttribute('href') || '';
                            return name ? { company_name: name, city: cityName, address: addr, phone: phone, website: web, category: category } : null;
                        }).filter(x => x);
                    }, city, kw);

                    if (results && results.length > 0) {
                        const unique = results.filter(r => {
                            const key = `${r!.company_name}_${city}`.toLowerCase();
                            if (seen.has(key)) return false;
                            seen.add(key);
                            return true;
                        });
                        if (unique.length > 0) await csvWriter.writeRecords(unique as any);
                        console.log(`   📄 PG Page ${p}: found ${results.length} (${unique.length} new)`);
                    } else break;
                    await new Promise(r => setTimeout(r, 1000));
                }
            } catch (e) { console.log(`   ⚠️ PG Error: ${(e as Error).message}`); }

            // --- MAPS ---
            try {
                const mapsUrl = `https://www.google.com/search?q=${encodeURIComponent(kw + ' ' + city)}&tbm=lcl&hl=en&gl=us`;
                await page.goto(mapsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                const mResults = await page.evaluate((cityName, category) => {
                    return Array.from(document.querySelectorAll('.VkpGBb, div[jscontroller="AtSb"], .dbg0pd')).map(item => {
                        const name = item.textContent?.split('\n')[0].trim();
                        return name ? { company_name: name, city: cityName, address: '', phone: '', website: '', category: category } : null;
                    }).filter(x => x);
                }, city, kw);

                if (mResults && mResults.length > 0) {
                    const unique = mResults.filter(r => {
                        const key = `${r!.company_name}_${city}`.toLowerCase();
                        if (seen.has(key)) return false;
                        seen.add(key);
                        return true;
                    });
                    if (unique.length > 0) await csvWriter.writeRecords(unique as any);
                    console.log(`   📍 Maps: found ${mResults.length} (${unique.length} new)`);
                }
            } catch (e) { console.log(`   ⚠️ Maps Error: ${(e as Error).message}`); }
        }
    }

    console.log("✨ RESCUE RUN FINISHED!");
    await browser.close();
}

run();
