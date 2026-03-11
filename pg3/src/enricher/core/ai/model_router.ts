import { config } from '../../config';
import { Logger } from '../../utils/logger';

/**
 * 🚦 MODEL ROUTER — Task-aware AI selection
 *
 * Routes by capability first, difficulty second.
 * The goal is the cheapest model chain that still satisfies the task contract.
 */

export enum TaskDifficulty {
    SIMPLE = 'SIMPLE',
    MODERATE = 'MODERATE',
    COMPLEX = 'COMPLEX',
    HARD = 'HARD'
}

export type LLMTaskProfile =
    | 'company_validation'
    | 'contact_extraction'
    | 'business_classification'
    | 'serp_url_selection'
    | 'agent_navigation'
    | 'deep_reasoning';

export class ModelRouter {
    private static roundRobinIndex = 0;

    public static selectModel(difficulty: TaskDifficulty): string {
        return this.selectModelChain(difficulty)[0];
    }

    public static selectTaskChain(task: LLMTaskProfile, options?: { strictJson?: boolean }): string[] {
        const strictJson = options?.strictJson ?? false;
        const preferred = (() => {
            switch (task) {
                case 'company_validation':
                    return strictJson
                        ? ['deepseek-chat', 'glm-4.7-flash', 'gpt-4o-mini', 'kimi-k2.5']
                        : ['glm-4.7-flash', 'deepseek-chat', 'gpt-4o-mini'];
                case 'contact_extraction':
                    return strictJson
                        ? ['deepseek-chat', 'glm-4.7-flash', 'gpt-4o-mini']
                        : ['glm-4.7-flash', 'deepseek-chat', 'gpt-4o-mini'];
                case 'business_classification':
                    return ['glm-4.7-flash', 'deepseek-chat', 'gpt-4o-mini', 'kimi-k2.5'];
                case 'serp_url_selection':
                    return strictJson
                        ? ['deepseek-chat', 'gpt-4o-mini', 'glm-4.7-flash']
                        : ['glm-4.7-flash', 'deepseek-chat', 'gpt-4o-mini'];
                case 'agent_navigation':
                    return ['kimi-k2.5', 'deepseek-reasoner', 'glm-5', 'gpt-4o'];
                case 'deep_reasoning':
                default:
                    return ['deepseek-reasoner', 'kimi-k2.5', 'glm-5', 'gpt-4o'];
            }
        })();

        const chain = this.filterAvailable(preferred);
        if (chain.length > 0) {
            return chain;
        }

        return this.selectModelChain(this.mapTaskToDifficulty(task));
    }

    public static selectModelChain(difficulty: TaskDifficulty): string[] {
        switch (difficulty) {
            case TaskDifficulty.SIMPLE:
                return this.filterAvailable(this.rotateFreeModels(['glm-4.7-flash', 'deepseek-chat', 'kimi-k2.5', 'gpt-4o-mini']));
            case TaskDifficulty.MODERATE:
                return this.filterAvailable(this.rotateFreeModels(['deepseek-chat', 'glm-4.7-flash', 'kimi-k2.5', 'gpt-4o-mini']));
            case TaskDifficulty.COMPLEX:
                return this.filterAvailable(['glm-5', 'kimi-k2.5', 'deepseek-chat', 'gpt-4o-mini']);
            case TaskDifficulty.HARD:
            default:
                return this.filterAvailable(['kimi-k2.5', 'deepseek-reasoner', 'glm-5', 'gpt-4o']);
        }
    }

    public static logSelection(taskName: string, difficulty: TaskDifficulty): void {
        const chain = this.selectModelChain(difficulty);
        Logger.info(`🚦 [ModelRouter] Task: "${taskName}" [${difficulty}] -> Primary: ${chain[0]}, Fallbacks: [${chain.slice(1).join(', ')}]`);
    }

    public static logTaskSelection(taskName: LLMTaskProfile, options?: { strictJson?: boolean }): void {
        const chain = this.selectTaskChain(taskName, options);
        Logger.info(`🚦 [ModelRouter] Task Profile: "${taskName}" -> Primary: ${chain[0]}, Fallbacks: [${chain.slice(1).join(', ')}]`);
    }

    private static rotateFreeModels(models: string[]): string[] {
        const available = this.filterAvailable(models);
        if (available.length === 0) {
            return ['gpt-4o-mini'];
        }

        this.roundRobinIndex = (this.roundRobinIndex + 1) % available.length;
        return [
            ...available.slice(this.roundRobinIndex),
            ...available.slice(0, this.roundRobinIndex),
        ];
    }

    private static filterAvailable(models: string[]): string[] {
        const uniqueModels = [...new Set(models)];
        const chain = uniqueModels.filter((model) => this.isModelAvailable(model));
        if (chain.length === 0 && config.llm.apiKeys && config.llm.apiKeys.length > 0) {
            return ['gpt-4o-mini'];
        }
        return chain;
    }

    private static isModelAvailable(model: string): boolean {
        if (model.startsWith('glm-')) return config.llm.z_ai.apiKeys.length > 0;
        if (model.startsWith('deepseek-')) return config.llm.deepseek.apiKeys.length > 0;
        if (model.startsWith('moonshot-') || model.startsWith('kimi-')) return config.llm.kimi.apiKeys.length > 0;
        return !!(config.llm.apiKeys && config.llm.apiKeys.length > 0);
    }

    private static mapTaskToDifficulty(task: LLMTaskProfile): TaskDifficulty {
        switch (task) {
            case 'company_validation':
            case 'contact_extraction':
                return TaskDifficulty.SIMPLE;
            case 'business_classification':
            case 'serp_url_selection':
                return TaskDifficulty.MODERATE;
            case 'agent_navigation':
                return TaskDifficulty.COMPLEX;
            case 'deep_reasoning':
            default:
                return TaskDifficulty.HARD;
        }
    }
}
