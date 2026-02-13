import { Logger } from '../../utils/logger';
import { LLMService } from '../ai/llm_service';

export class SelectorHealer {
    private static instance: SelectorHealer;

    private constructor() { }

    public static getInstance(): SelectorHealer {
        if (!SelectorHealer.instance) {
            SelectorHealer.instance = new SelectorHealer();
        }
        return SelectorHealer.instance;
    }

    /**
     * Attempts to find a CSS selector in the provided HTML component.
     */
    public async heal(html: string, goal: string): Promise<string | null> {
        if (!html) {
            Logger.warn(`[Healer] HTML is empty. Skipping.`);
            return null;
        }

        Logger.info(`[Healer] 🚑 Attempting to heal selector for: ${goal}`);

        // Truncate HTML to save tokens/cost
        const truncatedHtml = LLMService.truncate(html, 4000); // Use service truncator

        const prompt = `
        You are an expert Frontend Engineer and Web Scraper.
        Your task is to analyze the provided HTML (or snippet) and identify the CSS selector that corresponds to the goal description.
        
        Goal: "${goal}"
        
        HTML Snippet:
        ${truncatedHtml}
        
        Rules:
        1. Return ONLY the CSS selector string. No JSON, no markdown, no explanation.
        2. Prefer generic but accurate class names (e.g. ".search-result a") over brittle ones (e.g. ".div:nth-child(3)").
        3. If multiple exist, combine them with commas or pick the most robust one.
        `;

        try {
            // Uses configured provider (Z.ai or OpenAI) automatically
            const selector = await LLMService.complete(prompt);

            if (selector && selector.length > 2) {
                // Remove markdown code blocks if any
                const cleanSelector = selector.replace(/`/g, '').trim();
                Logger.info(`[Healer] 🩹 Suggested fix: "${cleanSelector}"`);
                return cleanSelector;
            }

            return null;

        } catch (error) {
            Logger.error('[Healer] Failed to heal selector', { error: error as Error });
            return null;
        }
    }
}
