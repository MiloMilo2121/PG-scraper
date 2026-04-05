
import { LLMService } from '../ai/llm_service';
import { DOMSnapshot } from './dom_distiller';
import { Logger } from '../../utils/logger';
import { AGENT_NAVIGATION_PROMPT } from '../ai/prompt_templates';
import { ModelRouter } from '../ai/model_router';

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
    private static TASK_PROFILE = 'agent_navigation' as const;

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
            const modelChain = ModelRouter.selectTaskChain(this.TASK_PROFILE, { strictJson: true });
            const decision = await LLMService.completeStructured<AgentDecision>(
                prompt,
                AGENT_NAVIGATION_PROMPT.schema as Record<string, unknown>,
                modelChain[0],
                modelChain.slice(1),
                AGENT_NAVIGATION_PROMPT.system,
            );

            ModelRouter.logTaskSelection(this.TASK_PROFILE, { strictJson: true });

            if (!decision) {
                return {
                    thought: "LLM returned null response",
                    action: 'FAIL'
                };
            }

            return this.validateDecision(decision);

        } catch (error) {
            Logger.error('[AgentBrain] Decision failed', { error: error as Error });
            return {
                thought: `Error: ${(error as Error).message}`,
                action: 'FAIL'
            };
        }
    }

    private static validateDecision(decision: AgentDecision): AgentDecision {
        switch (decision.action) {
            case 'CLICK':
                if (!decision.target_id) {
                    return {
                        thought: 'Invalid CLICK decision: missing target_id',
                        action: 'FAIL'
                    };
                }
                break;
            case 'TYPE':
                if (!decision.target_id || !decision.text_value) {
                    return {
                        thought: 'Invalid TYPE decision: missing target_id or text_value',
                        action: 'FAIL'
                    };
                }
                break;
            case 'EXTRACT':
                if (!decision.extraction_key) {
                    return {
                        thought: 'Invalid EXTRACT decision: missing extraction_key',
                        action: 'FAIL'
                    };
                }
                break;
            default:
                break;
        }

        return decision;
    }
}
