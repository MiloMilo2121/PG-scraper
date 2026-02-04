
import axios from 'axios';
import * as cheerio from 'cheerio';

export class SitemapParser {
    public static async parse(url: string): Promise<string[]> {
        try {
            const sitemapUrl = url.endsWith('.xml') ? url : `${url.replace(/\/$/, '')}/sitemap.xml`;
            const { data } = await axios.get(sitemapUrl, { timeout: 5000 });
            const $ = cheerio.load(data, { xmlMode: true });
            const urls: string[] = [];
            $('loc').each((i, el) => {
                const text = $(el).text();
                if (text) urls.push(text);
            });
            return urls;
        } catch (e) {
            return [];
        }
    }
}
