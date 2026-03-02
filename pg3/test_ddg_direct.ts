import axios from 'axios';
import { DuckDuckGoSerpAnalyzer } from './src/enricher/core/discovery/ddg_analyzer';

async function test() {
    try {
        const res = await axios.get('https://html.duckduckgo.com/html/?q=Elettronave+Brescia', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        });
        const results = DuckDuckGoSerpAnalyzer.parseSerp(res.data);
        console.log("SUCCESS:", results.length, "results");
        if (results.length === 0) console.log(res.data);
        console.log(JSON.stringify(results.slice(0, 2), null, 2));
    } catch (e: any) {
        console.error("FAIL:", e.message);
    }
}
test();
