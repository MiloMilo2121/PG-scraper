/**
 * HUMAN BEHAVIOR v3 - "Invisible Crowd"
 * Realistic browser behavior simulation
 *
 * Features:
 * - Poisson-distributed reading pauses (not uniform random)
 * - Focus/blur simulation (tab switching)
 * - Non-linear scroll patterns with micro-pauses
 * - Natural mouse movements
 */

import { Page } from 'puppeteer';
import { Logger } from '../../utils/logger';

export class HumanBehavior {

    /**
     * Poisson-distributed pause: Models real reading behavior
     * Human reading times follow an exponential distribution, not uniform.
     */
    static async readingPause(page: Page, meanMs = 2000): Promise<void> {
        const delay = this.poissonDelay(meanMs);
        const clamped = Math.min(Math.max(delay, 400), 8000);
        await new Promise(r => setTimeout(r, clamped));
    }

    /**
     * Legacy random pause (kept for backward compatibility)
     */
    static async randomPause(page: Page, min = 500, max = 3000): Promise<void> {
        const delay = Math.floor(Math.random() * (max - min + 1)) + min;
        await new Promise(r => setTimeout(r, delay));
    }

    /**
     * Mouse movement with natural randomness
     */
    static async randomMouseMove(page: Page): Promise<void> {
        try {
            const width = page.viewport()?.width || 1920;
            const height = page.viewport()?.height || 1080;

            const steps = Math.floor(Math.random() * 8) + 5;
            const x = Math.floor(Math.random() * (width - 200)) + 100;
            const y = Math.floor(Math.random() * (height - 200)) + 100;

            await page.mouse.move(x, y, { steps });
        } catch (e) {
            Logger.warn('[HumanBehavior] randomMouseMove skipped', { error: e as Error });
        }
    }

    /**
     * Realistic reading simulation with scroll, pause, mouse
     */
    static async simulateReading(page: Page): Promise<void> {
        try {
            // Initial reading pause
            await this.readingPause(page, 1500);

            // Scroll down naturally
            await this.realisticScroll(page);

            // Maybe move mouse to a random spot
            if (Math.random() < 0.7) {
                await this.randomMouseMove(page);
            }

            // Simulate focus/blur (tab switching)
            await this.simulateFocusBlur(page);

            // Final brief pause
            await this.readingPause(page, 800);
        } catch (e) {
            Logger.warn('[HumanBehavior] simulateReading skipped', { error: e as Error });
        }
    }

    /**
     * Non-linear scroll with variable speed and micro-pauses
     */
    static async realisticScroll(page: Page): Promise<void> {
        try {
            const totalScroll = 300 + Math.random() * 700;
            let scrolled = 0;

            while (scrolled < totalScroll) {
                // Variable scroll increments
                const increment = 40 + Math.random() * 160;
                const delay = 15 + Math.random() * 50;

                await page.evaluate((delta) => {
                    window.scrollBy({ top: delta, behavior: 'smooth' });
                }, Math.round(increment));

                scrolled += increment;
                await new Promise(r => setTimeout(r, delay));

                // 15% chance of micro-pause (user reading a section)
                if (Math.random() < 0.15) {
                    await new Promise(r => setTimeout(r, 500 + Math.random() * 1500));
                }
            }

            // 20% chance of scrolling back up slightly
            if (Math.random() < 0.2) {
                const backScroll = -(50 + Math.random() * 150);
                await page.evaluate((delta) => {
                    window.scrollBy({ top: delta, behavior: 'smooth' });
                }, Math.round(backScroll));
            }
        } catch (e) {
            Logger.warn('[HumanBehavior] realisticScroll skipped', { error: e as Error });
        }
    }

    /**
     * Focus/blur simulation: 10% chance of "tabbing away" briefly
     */
    static async simulateFocusBlur(page: Page): Promise<void> {
        if (Math.random() > 0.1) return;

        try {
            // Tab away
            await page.evaluate(() => {
                window.dispatchEvent(new Event('blur'));
            });

            // Away for 1-5 seconds
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 4000));

            // Tab back
            await page.evaluate(() => {
                window.dispatchEvent(new Event('focus'));
            });
        } catch (e) {
            // Page may have navigated, ignore
        }
    }

    // ── Private helpers ──────────────────────────────────────────────

    /**
     * Poisson-like delay using inverse transform sampling (exponential interarrival)
     */
    private static poissonDelay(meanMs: number): number {
        const u = Math.random();
        // Clamp u away from 0 to avoid -Infinity
        return Math.round(-meanMs * Math.log(Math.max(u, 0.001)));
    }
}
