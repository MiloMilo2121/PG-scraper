
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
        const pricing = config.llm.pricing;

        switch (difficulty) {
            case TaskDifficulty.SIMPLE:
                // TIER 1: Flash / Instant
                // Target: GLM-4.7-FlashX ($0.07/M)
                if (pricing['glm-4.7-flash']) return 'glm-4.7-flash';
                return 'glm-4-flash'; // Fallback

            case TaskDifficulty.MODERATE:
                // TIER 2: Smart & Cheap
                // Target: DeepSeek V3.2 ($0.28/M)
                if (pricing['deepseek-v3.2']) return 'deepseek-v3.2';
                if (pricing['deepseek-chat']) return 'deepseek-chat'; // V3 Legacy
                return 'glm-4-flash'; // Fallback to Z.ai if DeepSeek not available

            case TaskDifficulty.COMPLEX:
                // TIER 3: Reasoning Standard
                // Target: GLM-5 ($1.00/M)
                return 'glm-5';

            case TaskDifficulty.HARD:
                // TIER 4: Maximum Intelligence
                // Target: Kimi K2 Thinking ($0.60/M input, high output cost but worth it)
                if (pricing['moonshot-k2-thinking']) return 'moonshot-k2-thinking';
                // Fallback: DeepSeek R1/Reasoner or GLM-5
                if (pricing['deepseek-reasoner']) return 'deepseek-reasoner';
                return 'glm-5'; // Ultimate fallback

            default:
                Logger.warn(`[ModelRouter] Unknown difficulty ${difficulty}, defaulting to SIMPLE`);
                return 'glm-4.7-flash';
        }
    }

    /**
     * Logs the selection decision for observability.
     */
    public static logSelection(taskName: string, difficulty: TaskDifficulty): void {
        const model = this.selectModel(difficulty);
        Logger.info(`🚦 [ModelRouter] Task: "${taskName}" [${difficulty}] -> Using ${model}`);
    }
}
