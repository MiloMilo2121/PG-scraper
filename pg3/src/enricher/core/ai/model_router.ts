
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
                // Prioritize DeepSeek if available (More reliable than Z.ai currently)
                if (config.llm.deepseek?.apiKey) return 'deepseek-chat';

                // Target: GLM-4.7-FlashX ($0.07/M)
                if (config.llm.z_ai?.apiKey && pricing['glm-4.7-flash']) return 'glm-4.7-flash';
                return 'gpt-4o-mini'; // Fallback to OpenAI if Z.ai missing

            case TaskDifficulty.MODERATE:
                // TIER 2: Smart & Cheap
                // Target: DeepSeek V3.2 ($0.28/M)
                if (config.llm.deepseek?.apiKey) return 'deepseek-v3.2';
                // Fallback: GLM-4 Flash (Z.ai)
                if (config.llm.z_ai?.apiKey) return 'glm-4-flash';
                return 'gpt-4o-mini';

            case TaskDifficulty.COMPLEX:
                // TIER 3: Reasoning Standard
                // Target: GLM-5 ($1.00/M)
                if (config.llm.z_ai?.apiKey) return 'glm-5';
                return 'gpt-4o'; // Fallback

            case TaskDifficulty.HARD:
                // TIER 4: Maximum Intelligence
                // Target: Kimi K2 Thinking or DeepSeek R1
                if (config.llm.kimi?.apiKey) return 'moonshot-k2-thinking';
                if (config.llm.deepseek?.apiKey) return 'deepseek-reasoner';
                if (config.llm.z_ai?.apiKey) return 'glm-5';
                return 'gpt-4o'; // Ultimate fallback

            default:
                Logger.warn(`[ModelRouter] Unknown difficulty ${difficulty}, defaulting to SIMPLE`);
                return 'gpt-4o-mini';
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
