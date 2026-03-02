import axios from 'axios';
import * as cheerio from 'cheerio';
import { SocksProxyAgent } from 'socks-proxy-agent';

async function test(query: string) {
    const targetUrl = `https://search.brave.com/search?q=${encodeURIComponent(query)}`;

    let res;
    try {
        console.log("Fetching Brave with HTTPS...");
        res = await axios.get(targetUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7'
            }, 
            timeout: 8000
        });
    } catch (e: any) {
        console.error("Fetch failed:", e.message);
        return;
    }

    if (res.data.includes('Human Verification') || res.data.includes('unusual traffic')) {
        console.error('BRAVE_CAPTCHA_BLOCK');
        return;
    }

    const $ = cheerio.load(res.data);
    const results: any[] = [];
    
    $('.snippet[data-type="web"]').each((_: any, el: any) => {
        const linkTag = $(el).find('a').first();
        const url = linkTag.attr('href');
        const title = linkTag.find('.title, .netloc').text().trim() || linkTag.text().trim();
        const snippet = $(el).find('.snippet-description').text().trim() || '';

        if (url && url.startsWith('http')) {
            results.push({ url, title, snippet });
        }
    });

    if (results.length === 0) {
        $('a').each((_: any, el: any) => {
            const url = $(el).attr('href');
            const hasHeading = $(el).find('h2, h3').length > 0 || $(el).closest('h2, h3').length > 0;
            const title = $(el).text().trim();

            if (url && url.startsWith('http') && hasHeading && !url.includes('brave.com')) {
                results.push({ url, title, snippet: '' });
            }
        });
    }

    console.log(`Found ${results.length} results.`);
    console.log(JSON.stringify(results.slice(0, 3), null, 2));
}

test('Autofficina Coffani di Coffani Massimiliano sito web');
