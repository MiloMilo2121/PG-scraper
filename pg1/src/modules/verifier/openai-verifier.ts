import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import { logger } from '../observability';

dotenv.config();

export interface VerificationResult {
    is_match: boolean;
    confidence: number;
    reason: string;
}

export interface CompanyInfo {
    company_name: string;
    city: string;
    address?: string;
    industry?: string;
    phone?: string;
}

export interface CandidateInfo {
    url: string;
    page_title?: string;
    content_snippet?: string;
}

export class OpenAIVerifier {
    private static client: OpenAI | null = null;

    private static getClient(): OpenAI {
        if (!this.client) {
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey || apiKey === 'sk-your-api-key-here') {
                throw new Error('OPENAI_API_KEY not configured in .env file');
            }
            this.client = new OpenAI({ apiKey });
        }
        return this.client;
    }

    static async verify(company: CompanyInfo, candidate: CandidateInfo, options: { looseMatch?: boolean } = {}): Promise<VerificationResult> {
        try {
            const client = this.getClient();

            let instructions = `
ISTRUZIONI:
1. Verifica se il sito web appartiene ESATTAMENTE a questa azienda
2. Considera: nome azienda nel sito, località, settore di attività
3. Se il sito è un portale generico (es. paginegialle, yelp) rispondi NO
4. Se il sito è di un'azienda DIVERSA con nome simile, rispondi NO`;

            if (options.looseMatch) {
                instructions = `
ISTRUZIONI (MODALITÀ SHERLOCK):
1. L'obiettivo è trovare QUALSIASI presenza online valida per questa azienda
2. Accetta Pagine Facebook, Instagram, LinkedIn se sembrano ufficiali
3. Accetta schede su portali (PagineGialle, Virgilio, ecc.) SOLO SE contengono il numero di telefono corretto (${company.phone}) o indirizzo esatto
4. Rifiuta solo se sei sicuro che sia un'altra azienda o una pagina vuota`;
            }

            const prompt = `Sei un esperto di ricerca aziendale italiana. Devi verificare se un sito web appartiene a un'azienda specifica.

AZIENDA DA CERCARE:
- Nome: ${company.company_name}
- Città: ${company.city}
${company.address ? `- Indirizzo: ${company.address}` : ''}
${company.industry ? `- Settore: ${company.industry}` : ''}
${company.phone ? `- Telefono: ${company.phone}` : ''}

SITO WEB CANDIDATO:
- URL: ${candidate.url}
${candidate.page_title ? `- Titolo pagina: ${candidate.page_title}` : ''}
${candidate.content_snippet ? `- Estratto contenuto: ${candidate.content_snippet.substring(0, 500)}` : ''}

${instructions}

Rispondi SOLO con un JSON valido in questo formato esatto:
{"is_match": true, "confidence": 85, "reason": "Il nome azienda corrisponde e la città è corretta"}

oppure

{"is_match": false, "confidence": 10, "reason": "Il sito appartiene a un'azienda diversa"}`;

            const response = await client.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                max_tokens: 200
            });

            const content = response.choices[0]?.message?.content || '';

            // Parse JSON response
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]) as VerificationResult;
                logger.log('info', `[OpenAI] Verified ${candidate.url}: ${result.is_match ? 'MATCH' : 'NO MATCH'} (${result.confidence}%)`);
                return result;
            }

            // Fallback if parsing fails
            logger.log('warn', `[OpenAI] Could not parse response: ${content}`);
            return { is_match: false, confidence: 0, reason: 'Could not parse AI response' };

        } catch (e: any) {
            logger.log('error', `[OpenAI] Verification error: ${e.message}`);
            return { is_match: false, confidence: 0, reason: `Error: ${e.message}` };
        }
    }

    static isConfigured(): boolean {
        const apiKey = process.env.OPENAI_API_KEY;
        return !!(apiKey && apiKey !== 'sk-your-api-key-here');
    }
}
