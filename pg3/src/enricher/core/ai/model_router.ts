import { config } from '../../config';
import { Logger } from '../../utils/logger';

/**
 * 🚦 MODEL ROUTER — Intelligent AI Selection (Updated Feb 2026)
 *
 * Decides which model to use based on the complexity of the task.
 * Cost-optimized chains — cheapest viable model first, quality fallbacks after.
 *
 * Strategies:
 * - SIMPLE: glm-4.7-flash (FREE!) → deepseek-chat ($0.14/$0.28) → gpt-4o-mini
 * - MODERATE: deepseek-chat → glm-4.7-flash (FREE) → gpt-4o-mini
 * - COMPLEX: glm-5 ($1/$3.2) → kimi-k2.5 ($0.6/$3) → deepseek-chat → gpt-4o
 * - HARD: kimi-k2.5 → deepseek-reasoner ($0.55/$2.19) → glm-5 → gpt-4o
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

    private static roundRobinIndex = 0;

    /**
     * Returns an ordered fallback chain of models for the given difficulty tier.
     * When the primary model returns 429/5xx, callers should try the next model in the chain.
     * Implements Round-Robin across free tier providers to distribute load.
     */
    public static selectModelChain(difficulty: TaskDifficulty): string[] {
        const chain: string[] = [];

        const freeModels: string[] = [];
        if (config.llm.z_ai.apiKeys.length > 0) freeModels.push('glm-4.7-flash');
        if (config.llm.deepseek.apiKeys.length > 0) freeModels.push('deepseek-chat');
        if (config.llm.kimi.apiKeys.length > 0) freeModels.push('kimi-k2.5');

        let rotatedFreeModels: string[] = [];
        if (freeModels.length > 0) {
            this.roundRobinIndex = (this.roundRobinIndex + 1) % freeModels.length;
            rotatedFreeModels = [
                ...freeModels.slice(this.roundRobinIndex),
                ...freeModels.slice(0, this.roundRobinIndex)
            ];
        }

        switch (difficulty) {
            case TaskDifficulty.SIMPLE:
            case TaskDifficulty.MODERATE:
            case TaskDifficulty.COMPLEX:
                // ZERO COST OVERRIDE: Distribute all load across free models evenly!
                chain.push(...rotatedFreeModels);
                if (config.llm.apiKeys && config.llm.apiKeys.length > 0) chain.push('gpt-4o-mini');
                break;

            case TaskDifficulty.HARD:
                // K2.5 best for deep reasoning, then reasoning specialists
                if (config.llm.kimi.apiKeys.length > 0) chain.push('kimi-k2.5');
                if (config.llm.deepseek.apiKeys.length > 0) chain.push('deepseek-reasoner');
                if (config.llm.z_ai.apiKeys.length > 0) chain.push('glm-5');
                if (config.llm.apiKeys && config.llm.apiKeys.length > 0) chain.push('gpt-4o');
                break;

            default:
                Logger.warn(`[ModelRouter] Unknown difficulty ${difficulty}, defaulting to SIMPLE`);
                chain.push(...rotatedFreeModels);
                if (config.llm.apiKeys && config.llm.apiKeys.length > 0) chain.push('gpt-4o-mini');
                break;
        }

        // Guarantee at least one model in the chain
        if (chain.length === 0) {
            chain.push('gpt-4o-mini'); // Final safety catch
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
