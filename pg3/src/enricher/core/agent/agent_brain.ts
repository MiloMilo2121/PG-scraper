
import { LLMService } from '../ai/llm_service';
import { DOMSnapshot } from './dom_distiller';
import { Logger } from '../../utils/logger';
import { config } from '../../config';
import { LLMService } from '../ai/llm_service';
import { ModelRouter, TaskDifficulty } from '../ai/model_router';

/**
 * 🧠 AGENT BRAIN (The Decision Maker)
 * Decides the next action based on DOM snapshot and goal.
 * Uses structured prompts from PromptTemplates library (Law 506).
 */

export interface AgentDecision {
    thought: string;
    action: 'CLICK' | 'TYPE' | 'SCROLL' | 'EXTRACT' | 'DONE' | 'FAIL';
    target_id?: string;
    text_value?: string;
    extraction_key?: string;
}

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

        // Build structured prompt from template
        const prompt = AGENT_NAVIGATION_PROMPT.template({
            goal,
            pageTitle: snapshot.title,
            pageUrl: snapshot.url,
            domSummary: snapshot.summary,
            actionHistory: history,
        });

        try {
            const decision = await LLMService.completeStructured<AgentDecision>(
                prompt,
                AGENT_NAVIGATION_PROMPT.schema as Record<string, unknown>,
                AGENT_NAVIGATION_PROMPT.schema as Record<string, unknown>,
                ModelRouter.selectModel(TaskDifficulty.COMPLEX) // 🧠 ROUTER: Complex task -> GLM-5
            );

            // Log selection
            ModelRouter.logSelection('AgentDecision', TaskDifficulty.COMPLEX);

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
