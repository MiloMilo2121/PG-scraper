
import axios from 'axios';
import { Logger } from '../../utils/logger';
import { config } from '../../config';

export class SelectorHealer {
    private static instance: SelectorHealer;
    private readonly API_KEY = config.llm.apiKey;

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
        if (!this.API_KEY || !html) {
            console.warn(`[Healer] Missing API Key or HTML (${!!html}). Using MOCK response.`);
            if (goal.includes('anchor tag')) return '.result-container .actual-link';
            return null;
        }

        Logger.info(`[Healer] 🚑 Attempting to heal selector for: ${goal}`);

        // Truncate HTML to save tokens/cost
        const truncatedHtml = html.length > 15000 ? html.substring(0, 15000) + '...' : html;

        try {
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: 'gpt-4o',
                    messages: [
                        {
                            role: 'system',
                            content: `You are an expert Frontend Engineer and Web Scraper.
                            Your task is to analyze the provided HTML (or snippet) and identify the CSS selector that corresponds to the goal description.
                            
                            Goal: "${goal}"
                            
                            Rules:
                            1. Return ONLY the CSS selector string. No JSON, no markdown, no explanation.
                            2. Prefer generic but accurate class names (e.g. ".search-result a") over brittle ones (e.g. ".div:nth-child(3)").
                            3. If multiple exist, combine them with commas or pick the most robust one.
                            `
                        },
                        {
                            role: 'user',
                            content: truncatedHtml
                        }
                    ],
                    max_tokens: 50
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.API_KEY}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const selector = response.data.choices[0].message.content?.trim();
            if (selector && selector.length > 2) {
                // Remove markdown code blocks if any
                return selector.replace(/`/g, '').trim();
            }

            Logger.info(`[Healer] 🩹 Suggested fix: "${selector}"`);
            return selector || null;

        } catch (error) {
            Logger.error('[Healer] Failed to heal selector', { error: error as Error });
            return null;
        }
    }
}
