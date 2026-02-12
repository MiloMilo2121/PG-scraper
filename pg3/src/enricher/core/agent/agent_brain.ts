
import { LLMService } from '../ai/llm_service';
import { DOMSnapshot } from './dom_distiller';
import { Logger } from '../../utils/logger';

/**
 * 🧠 AGENT BRAIN (The Decision Maker)
 * Decides the next action based on DOM snapshot and goal.
 * Uses Structured Outputs for guaranteed valid JSON.
 */

export interface AgentDecision {
    thought: string;
    action: 'CLICK' | 'TYPE' | 'SCROLL' | 'EXTRACT' | 'DONE' | 'FAIL';
    target_id?: string;
    text_value?: string;
    extraction_key?: string;
}

const DECISION_SCHEMA = {
    type: 'object' as const,
    properties: {
        thought: { type: 'string' as const, description: "Reasoning for the chosen action" },
        action: {
            type: 'string' as const,
            enum: ['CLICK', 'TYPE', 'SCROLL', 'EXTRACT', 'DONE', 'FAIL']
        },
        target_id: { type: 'string' as const, description: "ID of the element from the snapshot" },
        text_value: { type: 'string' as const, description: "Text to type (for TYPE action)" },
        extraction_key: { type: 'string' as const, description: "Key name for extracted data (e.g., 'vat_number')" }
    },
    required: ['thought', 'action'] as const,
    additionalProperties: false as const
};

export class AgentBrain {

    /**
     * Decides the next step to achieve the goal on the current page.
     * @param snapshot Distilled DOM snapshot
     * @param goal Natural language goal (e.g. "Find the VAT number")
     * @param history List of past actions to avoid loops
     */
    public static async decide(
        snapshot: DOMSnapshot,
        goal: string,
        history: string[]
    ): Promise<AgentDecision> {

        const prompt = `
GOAL: ${goal}

CURRENT PAGE:
Title: ${snapshot.title}
URL: ${snapshot.url}

DISTILLED DOM (Interactive elements have IDs like [BTN id=1]):
${snapshot.summary}

HISTORY (Last 5 actions):
${history.slice(-5).join('\n')}

INSTRUCTIONS:
1. Analyze the DOM to find elements relevant to the GOAL.
2. If the goal is achieved (e.g. you see the data), use EXTRACT then DONE.
3. If you see a likely path (e.g. "Contatti", "Legal"), CLICK it.
4. If a cookie banner wants acceptance, CLICK the verify/accept button.
5. Do not repeat actions from HISTORY.
6. If stuck, try SCROLL to reveal more.
7. Return a precise JSON decision.
        `.trim();

        try {
            // Use o3-mini for reasoning capabilities ("Thinking Model") as requested.
            // Cost: ~$1.10/1M input. Session cost: ~$0.025.
            const decision = await LLMService.completeStructured<AgentDecision>(
                prompt,
                DECISION_SCHEMA as Record<string, unknown>,
                'o3-mini'
            );

            if (!decision) {
                return {
                    thought: "LLM returned null response",
                    action: 'FAIL'
                };
            }

            return decision;

        } catch (error) {
            Logger.error('[AgentBrain] Decision failed', { error: error as Error });
            return {
                thought: `Error: ${(error as Error).message}`,
                action: 'FAIL'
            };
        }
    }
}
