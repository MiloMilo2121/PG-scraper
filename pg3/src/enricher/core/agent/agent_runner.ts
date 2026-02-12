
import { Page } from 'puppeteer';
import { AgentBrain, AgentDecision } from './agent_brain';
import { DOMDistiller, InteractiveElement } from './dom_distiller';
import { Logger } from '../../utils/logger';
import { LLMService } from '../ai/llm_service';

/**
 * 🏃 AGENT RUNNER (The Executor)
 * Orchestrates the OODA loop: Observe -> Orient -> Decide -> Act.
 * Enforces safety limits (max steps, timeouts) and handles errors.
 */
export class AgentRunner {
    private static MAX_STEPS = 10; // Capped for cost safety (~$0.005 max per session with 4o-mini)
    private static TIMEOUT_MS = 45000; // 45s for fallback is enough

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

                        // 2. DECIDE
                        const decision = await AgentBrain.decide(snapshot, goal, history);
                        Logger.info(`[AgentRunner] Step ${steps}: ${decision.thought} -> ${decision.action}`);

                        // 3. ACT
                        const actionResult = await this.executeAction(page, decision, snapshot.interactive);

                        // Record history
                        history.push(`Step ${steps}: ${decision.action} ${decision.target_id || ''} -> ${actionResult}`);

                        if (decision.action === 'DONE') {
                            finalResult = "Goal Achieved";
                            break;
                        }
                        if (decision.action === 'EXTRACT') {
                            finalResult = decision.text_value || "Extracted Data";
                            break;
                        }
                        if (decision.action === 'FAIL') {
                            Logger.warn(`[AgentRunner] Agent gave up: ${decision.thought}`);
                            break;
                        }

                        // Wait a bit for page to settle
                        await new Promise(r => setTimeout(r, 2000));
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
                    await page.evaluate((xpath, text) => {
                        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                        const node = result.singleNodeValue as HTMLInputElement;
                        if (node) { node.value = text; node.dispatchEvent(new Event('input', { bubbles: true })); }
                    }, input.xpath, decision.text_value);

                    return `Typed "${decision.text_value}"`;

                case 'SCROLL':
                    await page.evaluate(() => window.scrollBy(0, 500));
                    return "Scrolled Down";

                case 'EXTRACT':
                    return "Extracted";

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
}
