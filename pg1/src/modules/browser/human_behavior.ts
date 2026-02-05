/**
 * 🎭 HUMAN BEHAVIOR SIMULATOR
 * Bezier mouse curves, reading pauses, and jitter
 * 
 * NINJA CORE - Shared between PG1 and PG3
 */

import { Page } from 'puppeteer';

export class HumanBehavior {

    /**
     * injectBioMimicry - Random human pause
     */
    static async randomPause(page: Page, min = 500, max = 3000): Promise<void> {
        const delay = Math.floor(Math.random() * (max - min + 1)) + min;
        await new Promise(r => setTimeout(r, delay));
    }

    /**
     * Task 8: Random Mouse Movement (Bézier-like simulation)
     */
    static async randomMouseMove(page: Page): Promise<void> {
        try {
            const width = page.viewport()?.width || 1920;
            const height = page.viewport()?.height || 1080;

            const steps = Math.floor(Math.random() * 5) + 5;
            const x = Math.floor(Math.random() * width);
            const y = Math.floor(Math.random() * height);

            await page.mouse.move(x, y, { steps });
        } catch (e) {
            // Ignore errors if page is closed
        }
    }

    /**
     * Simulates reading behavior: Scroll down slowly, pause, maybe scroll up a bit.
     */
    static async simulateReading(page: Page): Promise<void> {
        try {
            await this.randomPause(page, 1000, 2000);
            await page.evaluate(() => {
                window.scrollBy({ top: 500, behavior: 'smooth' });
            });
            await this.randomPause(page, 500, 1500);
            await this.randomMouseMove(page);
        } catch (e) { }
    }

    /**
     * Simulate human typing with jitter
     */
    static async humanType(page: Page, selector: string, text: string): Promise<void> {
        await page.click(selector);
        for (const char of text) {
            await page.keyboard.type(char);
            await new Promise(r => setTimeout(r, Math.random() * 150 + 50));
        }
    }
}
