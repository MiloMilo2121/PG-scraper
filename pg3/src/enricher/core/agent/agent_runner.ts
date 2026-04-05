
import { Page } from 'playwright';
import { AgentBrain, AgentDecision } from './agent_brain';
import { DOMDistiller, DOMSnapshot, InteractiveElement } from './dom_distiller';
import { Logger } from '../../utils/logger';

/**
 * 🏃 AGENT RUNNER (The Executor)
 * Orchestrates the OODA loop: Observe -> Orient -> Decide -> Act.
 * Enforces safety limits (max steps, timeouts) and handles errors.
 */
export class AgentRunner {
    private static MAX_STEPS = 10; // Capped for cost safety (~$0.005 max per session with 4o-mini)
    private static TIMEOUT_MS = 45000; // 45s for fallback is enough
    private static SETTLE_MS = 2000;
    private static MAX_IDENTICAL_DECISIONS_PER_PAGE = 2;
    private static MAX_SCROLL_ATTEMPTS_PER_PAGE = 3;

    /**
     * Run the autonomous Agent to achieve a specific goal on the page.
     * @param page Puppeteer page
     * @param goal Natural language goal (e.g. "Find VAT number")
     * @returns Result or null if failed
     */
    public static async run(page: Page, goal: string): Promise<string | null> {
        Logger.info(`[AgentRunner] Starting mission: "${goal}"`);
        const history: string[] = [];
        let steps = 0;
        let finalResult: string | null = null;
        let extractedKey: string | null = null;
        let extractedValue: string | null = null;
        const decisionFingerprintCounts = new Map<string, number>();
        const scrollAttemptsByPage = new Map<string, number>();
        const recentFingerprints: string[] = [];

        // Timeout handling
        const timeoutPromise = new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error('Agent Timeout')), this.TIMEOUT_MS)
        );

        try {
            await Promise.race([
                (async () => {
                    while (steps < this.MAX_STEPS && !finalResult) {
                        steps++;

                        // 1. OBSERVE
                        const snapshot = await DOMDistiller.capture(page);
                        const pageSignature = this.buildPageSignature(snapshot);

                        // 2. DECIDE
                        const decision = await AgentBrain.decide(snapshot, goal, history);
                        Logger.info(`[AgentRunner] Step ${steps}: ${decision.thought} -> ${decision.action}`);

                        const decisionFingerprint = this.buildDecisionFingerprint(pageSignature, decision);
                        if (this.shouldAbortForLoop(decision, decisionFingerprint, decisionFingerprintCounts, recentFingerprints)) {
                            Logger.warn(`[AgentRunner] Loop guard triggered at step ${steps}: ${decisionFingerprint}`);
                            break;
                        }

                        if (this.shouldAbortForScroll(decision, pageSignature, scrollAttemptsByPage)) {
                            Logger.warn(`[AgentRunner] Scroll guard triggered at step ${steps} on page signature ${pageSignature}`);
                            break;
                        }

                        // 3. ACT
                        const actionResult = await this.executeAction(page, decision, snapshot.interactive);

                        // Record history
                        history.push(`Step ${steps}: ${decision.action} ${decision.target_id || ''} -> ${actionResult}`);

                        if (decision.action === 'EXTRACT') {
                            extractedKey = decision.extraction_key || extractedKey;
                            if (actionResult.startsWith('EXTRACTED:')) {
                                extractedValue = actionResult.slice('EXTRACTED:'.length).trim() || extractedValue;
                            }
                            continue;
                        }
                        if (decision.action === 'DONE') {
                            finalResult = extractedValue || extractedKey || 'Goal Achieved';
                            break;
                        }
                        if (decision.action === 'FAIL') {
                            Logger.warn(`[AgentRunner] Agent gave up: ${decision.thought}`);
                            break;
                        }

                        // Wait a bit for page to settle
                        await new Promise(r => setTimeout(r, this.SETTLE_MS));
                    }
                })(),
                timeoutPromise
            ]);
        } catch (e) {
            Logger.error('[AgentRunner] Mission Aborted', { error: e as Error });
        }

        Logger.info(`[AgentRunner] Mission End. Steps: ${steps}. Result: ${finalResult ? 'SUCCESS' : 'FAILURE'}`);
        return finalResult;
    }

    private static buildPageSignature(snapshot: DOMSnapshot): string {
        return [
            snapshot.url.trim(),
            snapshot.title.trim(),
            snapshot.summary.replace(/\s+/g, ' ').trim().slice(0, 500),
        ].join('|');
    }

    private static buildDecisionFingerprint(pageSignature: string, decision: AgentDecision): string {
        return [
            pageSignature,
            decision.action,
            decision.target_id || '',
            decision.text_value || '',
            decision.extraction_key || '',
        ].join('|');
    }

    private static shouldAbortForLoop(
        decision: AgentDecision,
        fingerprint: string,
        counts: Map<string, number>,
        recentFingerprints: string[]
    ): boolean {
        if (decision.action === 'DONE' || decision.action === 'FAIL' || decision.action === 'SCROLL') {
            return false;
        }

        const nextCount = (counts.get(fingerprint) || 0) + 1;
        counts.set(fingerprint, nextCount);
        recentFingerprints.push(fingerprint);
        if (recentFingerprints.length > 4) {
            recentFingerprints.shift();
        }

        if (nextCount > this.MAX_IDENTICAL_DECISIONS_PER_PAGE) {
            return true;
        }

        if (recentFingerprints.length === 4) {
            const [a, b, c, d] = recentFingerprints;
            if (a === c && b === d) {
                return true;
            }
        }

        return false;
    }

    private static shouldAbortForScroll(
        decision: AgentDecision,
        pageSignature: string,
        scrollAttemptsByPage: Map<string, number>
    ): boolean {
        if (decision.action !== 'SCROLL') {
            return false;
        }

        const nextCount = (scrollAttemptsByPage.get(pageSignature) || 0) + 1;
        scrollAttemptsByPage.set(pageSignature, nextCount);
        return nextCount > this.MAX_SCROLL_ATTEMPTS_PER_PAGE;
    }

    private static async executeAction(
        page: Page,
        decision: AgentDecision,
        interactive: InteractiveElement[]
    ): Promise<string> {
        try {
            switch (decision.action) {
                case 'CLICK':
                    if (!decision.target_id) return "Error: No target_id for CLICK";
                    const target = interactive.find(el => el.id === decision.target_id);
                    if (!target) return `Error: Element ID ${decision.target_id} not found`;

                    // Re-locate element by XPath or robust selector for Puppeteer
                    const clicked = await page.evaluate((xpath) => {
                        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                        const node = result.singleNodeValue as HTMLElement;
                        if (node) { node.click(); return true; }
                        return false;
                    }, target.xpath);

                    return clicked ? "Clicked" : "Click Failed (Element missing)";

                case 'TYPE':
                    if (!decision.target_id || !decision.text_value) return "Error: Missing target or text for TYPE";
                    const input = interactive.find(el => el.id === decision.target_id);
                    if (!input) return `Error: Input ID ${decision.target_id} not found`;

                    await page.type('body', decision.text_value); // Fallback if specific input focus fails, but let's try strict
                    // Better: use the xpath to focus and type
                    await page.evaluate(({ xpath, text }) => {
                        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                        const node = result.singleNodeValue as HTMLInputElement;
                        if (node) { node.value = text; node.dispatchEvent(new Event('input', { bubbles: true })); }
                    }, { xpath: input.xpath, text: decision.text_value });

                    return `Typed "${decision.text_value}"`;

                case 'SCROLL':
                    await page.evaluate(() => window.scrollBy(0, 500));
                    return "Scrolled Down";

                case 'EXTRACT':
                    if (!decision.extraction_key) return 'Error: No extraction_key for EXTRACT';
                    return await this.extractVisibleData(page, decision.extraction_key);

                case 'DONE':
                case 'FAIL':
                    return "Terminating";

                default:
                    return "Unknown Action";
            }
        } catch (e) {
            return `Action Error: ${(e as Error).message}`;
        }
    }

    private static async extractVisibleData(page: Page, extractionKey: string): Promise<string> {
        const bodyText = await page.evaluate(() => document.body?.innerText || '');
        const normalizedKey = extractionKey.toLowerCase();

        const emailMatch = bodyText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
        const vatMatch =
            bodyText.match(/\b(?:P\.?\s*IVA|Partita\s*IVA|VAT)\D{0,8}(\d{11})\b/i) ||
            bodyText.match(/\b\d{11}\b/);
        const phoneMatch = bodyText.match(/(?:\+39\s*)?(?:\(?\d{2,4}\)?[\s./-]*){2,5}\d{2,4}/);

        if (normalizedKey.includes('email') || normalizedKey.includes('mail')) {
            return `EXTRACTED:${emailMatch?.[0] || ''}`;
        }

        if (normalizedKey.includes('vat') || normalizedKey.includes('piva')) {
            return `EXTRACTED:${vatMatch?.[1] || vatMatch?.[0] || ''}`;
        }

        if (normalizedKey.includes('phone') || normalizedKey.includes('tel')) {
            return `EXTRACTED:${phoneMatch?.[0] || ''}`;
        }

        return `EXTRACTED:${emailMatch?.[0] || vatMatch?.[1] || vatMatch?.[0] || phoneMatch?.[0] || ''}`;
    }
}
