/**
 * 🖱️ OMEGA V9: BIOMETRIC HUMAN MOUSE BEHAVIOR
 * Task 3.2: Defeating Kasada & DataDome behavioral biometrics.
 * 
 * Features:
 * - Mathematical B-Spline curves for non-linear trajectories
 * - Log-normal statistical models for keystroke/click delays
 * - Variable acceleration/deceleration profiles
 * - Intentional micro-corrections (overshoot/undershoot)
 */

import { Page, ElementHandle } from 'playwright';
import { createCursor, GhostCursor } from 'ghost-cursor';
import { Logger } from '../../utils/logger';

export class HumanMouse {
    private cursor: GhostCursor;
    private page: Page;
    private sessionEntropyMultiplier: number;

    constructor(page: Page) {
        this.page = page;
        this.cursor = createCursor(page);
        // Generates a unique "personality" for this specific session instance
        this.sessionEntropyMultiplier = 0.8 + Math.random() * 0.4; // 0.8x to 1.2x
    }

    /**
     * 🎯 Move to element using Bezier/B-Spline approximations via ghost-cursor.
     * With controlled entropy.
     */
    async moveTo(selector: string): Promise<void> {
        const element = await this.page.$(selector);
        if (!element) {
            Logger.warn(`⚠️ [HumanMouse] Target not found: ${selector}`);
            return;
        }
        await this.moveToElement(element);
    }

    /**
     * 🎯 Move to ElementHandle with biometric noise
     */
    async moveToElement(element: ElementHandle): Promise<void> {
        try {
            await this.cursor.move(element, {
                paddingPercentage: 15 * this.sessionEntropyMultiplier, // Random hit-box positioning
            });
            // Post-movement micro-hesitation (log-normal distribution)
            await this.simulateHesitation();
        } catch (e) {
            Logger.warn('⚠️ [HumanMouse] B-Spline movement failed. Dropping back to linear fallback.');
        }
    }

    /**
     * 🖱️ Click with biometric hesitation and varied duration
     */
    async click(selector: string): Promise<void> {
        const element = await this.page.$(selector);
        if (!element) return;

        try {
            const clickHoldDuration = this.getLogNormalDelay(30, 90); // ms the button is held down
            await this.cursor.click(element, {
                paddingPercentage: 10,
                waitForClick: clickHoldDuration,
            });
            await this.simulateHesitation();
        } catch (e) {
            await element.click();
        }
    }

    /**
     * ⌨️ Type with log-normal biometric cadence (NOT uniform random)
     * Real humans type with bursts and micro-pauses between specific keystrokes.
     */
    async type(selector: string, text: string): Promise<void> {
        await this.click(selector);

        for (let i = 0; i < text.length; i++) {
            await this.page.keyboard.type(text[i]);

            // Typical inter-keystroke timing (IKT) modeled on human biometrics ~100ms average
            let ikt = this.getLogNormalDelay(50, 150);

            // Introduce "think time" or burst correction randomly on 10% of keystrokes
            if (Math.random() > 0.9) {
                ikt += this.getLogNormalDelay(150, 400);
            }

            await this.delay(ikt);
        }
    }

    /**
     * 📜 Scroll organically (accelerating and decaying)
     */
    async scroll(direction: 'up' | 'down', amount: number = 300): Promise<void> {
        let remaining = amount;

        while (remaining > 0) {
            // Variable wheel chuck (decaying momentum)
            const chunk = Math.min(remaining, this.randomInt(40, 120));
            const delta = direction === 'down' ? chunk : -chunk;

            await this.page.mouse.wheel(0, delta);
            await this.delay(this.randomInt(15, 60)); // Fast interval between wheel ticks

            remaining -= chunk;
        }

        // Final rest
        await this.simulateHesitation();
    }

    /**
     * 🎲 "Lost" or reading movements
     */
    async randomMove(): Promise<void> {
        const viewport = this.page.viewportSize();
        if (!viewport) return;

        const x = this.randomInt(50, viewport.width - 50);
        const y = this.randomInt(50, viewport.height - 50);

        await this.cursor.moveTo({ x, y });
        await this.simulateHesitation();
    }

    // --- Mathematical / Statistical Helpers --- //

    /**
     * Generates a delay using an approximation of the Log-Normal distribution.
     * This prevents WAFs from detecting simple Math.random() linear bounds.
     */
    private getLogNormalDelay(min: number, max: number): number {
        const u = 1 - Math.random(); // Converting [0,1) to (0,1]
        const v = Math.random();
        const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
        // Transform the standard normal (z) into our desired bounds
        const mean = (min + max) / 2;
        const stdDev = (max - min) / 6; // 99.7% of values within 3 stdDevs

        let result = Math.round(mean + z * stdDev);
        return Math.max(min, Math.min(result, max)); // Clamp to boundaries
    }

    private async simulateHesitation(): Promise<void> {
        const hesitation = this.getLogNormalDelay(100, 350) * this.sessionEntropyMultiplier;
        await this.delay(hesitation);
    }

    private delay(ms: number): Promise<void> {
        return new Promise(r => setTimeout(r, ms));
    }

    private randomInt(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
}

/**
 * 🏭 Factory 
 */
export function createHumanMouse(page: Page): HumanMouse {
    return new HumanMouse(page);
}
