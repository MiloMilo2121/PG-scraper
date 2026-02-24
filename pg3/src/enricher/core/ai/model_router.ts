
import { config } from '../../config';
import { Logger } from '../../utils/logger';

/**
 * 🚦 MODEL ROUTER — Intelligent AI Selection
 *
 * Decides which model to use based on the complexity of the task.
 * Strategies:
 * - SIMPLE: Speed & throughput (Flash models)
 * - MODERATE: Structured data extraction / Reasoning Lite (DeepSeek V3)
 * - COMPLEX: Planning, multi-step reasoning (GLM-5)
 * - HARD: Deep reasoning, coding, analyzing failures (Kimi K2)
 */

export enum TaskDifficulty {
    SIMPLE = 'SIMPLE',       // Validation, simple classification
    MODERATE = 'MODERATE',   // Extraction, JSON parsing, basic summaries
    COMPLEX = 'COMPLEX',     // Agent planning, strategy execution
    HARD = 'HARD'            // Fallback for agent failures, deep analysis
}

export class ModelRouter {

    /**
     * Selects the best available model for the given difficulty tier.
     * Falls back to safer options if specific tier models aren't configured.
     */
    public static selectModel(difficulty: TaskDifficulty): string {
        return this.selectModelChain(difficulty)[0];
    }

    /**
     * Returns an ordered fallback chain of models for the given difficulty tier.
     * When the primary model returns 429/5xx, callers should try the next model in the chain.
     * This prevents a single rate-limited provider from killing the entire pipeline.
     */
    public static selectModelChain(difficulty: TaskDifficulty): string[] {
        const chain: string[] = [];

        switch (difficulty) {
            case TaskDifficulty.SIMPLE:
                if (config.llm.deepseek?.apiKey) chain.push('deepseek-chat');
                if (config.llm.z_ai?.apiKey) chain.push('glm-4-flash');
                if (config.llm.kimi?.apiKey) chain.push('moonshot-v1-8k');
                if (config.llm.apiKey) chain.push('gpt-4o-mini');
                break;

            case TaskDifficulty.MODERATE:
                if (config.llm.deepseek?.apiKey) chain.push('deepseek-v3.2');
                if (config.llm.z_ai?.apiKey) chain.push('glm-4-flash');
                if (config.llm.kimi?.apiKey) chain.push('moonshot-v1-8k');
                if (config.llm.apiKey) chain.push('gpt-4o-mini');
                break;

            case TaskDifficulty.COMPLEX:
                if (config.llm.z_ai?.apiKey) chain.push('glm-5');
                if (config.llm.deepseek?.apiKey) chain.push('deepseek-chat');
                if (config.llm.kimi?.apiKey) chain.push('moonshot-k2-thinking');
                if (config.llm.apiKey) chain.push('gpt-4o');
                break;

            case TaskDifficulty.HARD:
                if (config.llm.kimi?.apiKey) chain.push('moonshot-k2-thinking');
                if (config.llm.deepseek?.apiKey) chain.push('deepseek-reasoner');
                if (config.llm.z_ai?.apiKey) chain.push('glm-5');
                if (config.llm.apiKey) chain.push('gpt-4o');
                break;

            default:
                Logger.warn(`[ModelRouter] Unknown difficulty ${difficulty}, defaulting to SIMPLE`);
                if (config.llm.apiKey) chain.push('gpt-4o-mini');
                break;
        }

        // Guarantee at least one model in the chain
        if (chain.length === 0) {
            chain.push('gpt-4o-mini');
        }

        return chain;
    }

    /**
     * Logs the selection decision for observability.
     */
    public static logSelection(taskName: string, difficulty: TaskDifficulty): void {
        const chain = this.selectModelChain(difficulty);
        Logger.info(`🚦 [ModelRouter] Task: "${taskName}" [${difficulty}] -> Primary: ${chain[0]}, Fallbacks: [${chain.slice(1).join(', ')}]`);
    }
}
