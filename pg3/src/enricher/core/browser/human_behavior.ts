
import { Page } from 'puppeteer';
import { Logger } from '../../utils/logger';

export class HumanBehavior {

    /**
     * Task 9: Random Human Pause
     * Sleeps for a random duration between min and max ms.
     */
    static async randomPause(page: Page, min = 500, max = 3000): Promise<void> {
        const delay = Math.floor(Math.random() * (max - min + 1)) + min;
        await new Promise(r => setTimeout(r, delay));
    }

    /**
     * Task 8: Random Mouse Movement (Bézier-like simulation)
     * Simulates moving the mouse to a random element or coordinate.
     */
    static async randomMouseMove(page: Page): Promise<void> {
        try {
            const width = page.viewport()?.width || 1920;
            const height = page.viewport()?.height || 1080;

            // Simple random path (start -> end)
            // In a real stealth scenario we would use ghost-cursor, 
            // but for now native puppeteer steps are a good baseline.
            const steps = Math.floor(Math.random() * 5) + 5; // 5-10 steps
            const x = Math.floor(Math.random() * width);
            const y = Math.floor(Math.random() * height);

            await page.mouse.move(x, y, { steps });
        } catch (e) {
            Logger.warn('[HumanBehavior] randomMouseMove skipped', { error: e as Error });
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
        } catch (e) {
            Logger.warn('[HumanBehavior] simulateReading skipped', { error: e as Error });
        }
    }
}
