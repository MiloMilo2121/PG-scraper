
import { Page } from 'puppeteer';
import { Logger } from '../../utils/logger';

export class GoogleMapsProvider {
    public static async extractPins(page: Page, query: string): Promise<any[]> {
        // Logic similar to massive maps scraper but reusable
        // 1. Goto
        // 2. Scroll
        // 3. Extract
        return [];
    }
}
