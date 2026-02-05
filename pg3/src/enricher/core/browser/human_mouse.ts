/**
 * 🖱️ HUMAN-LIKE MOUSE BEHAVIOR
 * Task 14: ghost-cursor integration for realistic mouse movements
 * 
 * Features:
 * - Bezier curve mouse paths
 * - Random jitter and hesitation
 * - Overshoot and correction
 */

import { Page, ElementHandle } from 'puppeteer';
import { createCursor, GhostCursor } from 'ghost-cursor';
import { Logger } from '../../utils/logger';

export class HumanMouse {
    private cursor: GhostCursor;
    private page: Page;

    constructor(page: Page) {
        this.page = page;
        this.cursor = createCursor(page);
    }

    /**
     * 🎯 Move to element with human-like motion
     */
    async moveTo(selector: string): Promise<void> {
        const element = await this.page.$(selector);
        if (!element) {
            Logger.warn(`Element not found: ${selector}`);
            return;
        }
        await this.moveToElement(element);
    }

    /**
     * 🎯 Move to element handle
     */
    async moveToElement(element: ElementHandle): Promise<void> {
        try {
            await this.cursor.move(element, {
                paddingPercentage: 10, // Random position within element
            });
            // Add small random delay after movement
            await this.randomDelay(50, 150);
        } catch (e) {
            Logger.warn('Ghost cursor move failed, using fallback');
        }
    }

    /**
     * 🖱️ Click with realistic behavior
     */
    async click(selector: string): Promise<void> {
        const element = await this.page.$(selector);
        if (!element) {
            Logger.warn(`Click target not found: ${selector}`);
            return;
        }

        try {
            await this.cursor.click(element, {
                paddingPercentage: 10,
                waitForClick: this.randomInt(50, 200),
            });
        } catch (e) {
            // Fallback to regular click
            await element.click();
        }
    }

    /**
     * ⌨️ Type with human-like delays
     */
    async type(selector: string, text: string): Promise<void> {
        await this.click(selector);

        for (const char of text) {
            await this.page.keyboard.type(char);
            // Variable delay between keystrokes (50-150ms)
            await this.randomDelay(50, 150);
        }
    }

    /**
     * 📜 Scroll with natural behavior
     */
    async scroll(direction: 'up' | 'down', amount: number = 300): Promise<void> {
        const scrolls = Math.ceil(amount / 100);

        for (let i = 0; i < scrolls; i++) {
            const delta = direction === 'down' ? 100 : -100;
            await this.page.mouse.wheel({ deltaY: delta });
            await this.randomDelay(30, 80);
        }
    }

    /**
     * 🎲 Random movement to simulate looking around
     */
    async randomMove(): Promise<void> {
        const viewport = this.page.viewport();
        if (!viewport) return;

        const x = this.randomInt(100, viewport.width - 100);
        const y = this.randomInt(100, viewport.height - 100);

        await this.cursor.moveTo({ x, y });
    }

    /**
     * ⏳ Add random delay
     */
    private async randomDelay(min: number, max: number): Promise<void> {
        const delay = this.randomInt(min, max);
        await new Promise(r => setTimeout(r, delay));
    }

    private randomInt(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
}

/**
 * 🏭 Factory function for creating cursor on page
 */
export function createHumanMouse(page: Page): HumanMouse {
    return new HumanMouse(page);
}
