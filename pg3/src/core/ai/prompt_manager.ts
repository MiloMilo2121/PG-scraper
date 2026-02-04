
export enum PromptStrategy {
    STANDARD = 'STANDARD',
    CHAIN_OF_THOUGHT = 'CHAIN_OF_THOUGHT',
    JSON_FORCE = 'JSON_FORCE'
}

export class PromptManager {
    private static instance: PromptManager;

    private constructor() { }

    public static getInstance(): PromptManager {
        if (!PromptManager.instance) {
            PromptManager.instance = new PromptManager();
        }
        return PromptManager.instance;
    }

    public getPrompt(strategy: PromptStrategy, text: string): string {
        const baseInstructions = `Extract company details (VAT/PIVA, Phone, Email, Address, PEC) from the following text. Return ONLY valid JSON.`;

        switch (strategy) {
            case PromptStrategy.CHAIN_OF_THOUGHT:
                return `
                You are an expert data analyst.
                Step 1: Read the text carefully.
                Step 2: Identify any VAT number (P.IVA or IT...).
                Step 3: Identify any phone numbers (look for +39 or local prefixes).
                Step 4: Identify physical addresses.
                Step 5: Output the findings in strict JSON format.
                
                Text:
                ${text.substring(0, 15000)}
                `;

            case PromptStrategy.JSON_FORCE:
                return `
                ${baseInstructions}
                CRITICAL: Do not include markdown formatting like \`\`\`json. Just the raw JSON string.
                Structure: { "piva": "...", "phone": "...", "email": "...", "address": "...", "city": "..." }
                
                Text:
                ${text.substring(0, 15000)}
                `;

            case PromptStrategy.STANDARD:
            default:
                return `
                ${baseInstructions}
                Text:
                ${text.substring(0, 15000)}
                `;
        }
    }

    public getValidationPrompt(strategy: PromptStrategy, company: any): string {
        const base = `You are a Data Validation Expert. Your job is to verify if a WEBSITE belongs to a specific COMPANY created in the query.`;
        switch (strategy) {
            case PromptStrategy.CHAIN_OF_THOUGHT:
                return `${base}
                 Think Step-by-Step:
                 1. Compare Company Name (Allow fuzzy match).
                 2. Compare Location (City/Province).
                 3. Check Activity/Industry alignment.
                 4. Check for 'Domain For Sale' or generic directories.
                 5. Conclusion: Is it a match?
                 Output JSON: { "reasoning": "step-by-step...", "is_match": boolean, "confidence": number }`;
            default:
                return `${base}
                 Rules:
                 1. Ignore strict PIVA matches.
                 2. Semantic location matches are key.
                 3. Reject directories/parking.
                 Output JSON: { "is_match": boolean, "confidence": number, "reason": "short explanation" }`;
        }
    }
}
