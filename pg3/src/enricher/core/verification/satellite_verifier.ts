
import axios from 'axios';
import { Logger } from '../../utils/logger';
import { config } from '../../config';
import { LLMService } from '../ai/llm_service';
import { SATELLITE_ANALYSIS_PROMPT } from '../ai/prompt_templates';

export interface SatelliteAnalysisResult {
    isCommercial: boolean;
    confidence: number;
    buildingType: 'commercial' | 'residential' | 'industrial' | 'empty' | 'unknown';
    signageDetected: boolean;
    reason: string;
}

/**
 * 🛰️ SATELLITE VERIFIER
 * Fetches Google Street View images and analyzes them with LLM vision
 * to determine if a location is a real commercial business.
 *
 * Uses LLMService.completeVision() with structured prompt templates.
 */
export class SatelliteVerifier {
    private static instance: SatelliteVerifier;
    private readonly streetViewKey = process.env.GOOGLE_STREET_VIEW_KEY;

    private constructor() { }

    public static getInstance(): SatelliteVerifier {
        if (!SatelliteVerifier.instance) {
            SatelliteVerifier.instance = new SatelliteVerifier();
        }
        return SatelliteVerifier.instance;
    }

    /**
     * Fetches a Google Street View image for the given address.
     * Returns a base64 string of the image.
     */
    public async fetchStreetView(address: string, city: string): Promise<string | null> {
        if (!this.streetViewKey) {
            Logger.warn('[Satellite] No Google Street View API Key configured. Skipping.');
            return null;
        }

        const location = `${address}, ${city}, Italy`;
        const url = `https://maps.googleapis.com/maps/api/streetview?size=600x400&location=${encodeURIComponent(location)}&key=${this.streetViewKey}`;

        try {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            return Buffer.from(response.data, 'binary').toString('base64');
        } catch (error) {
            Logger.error(`[Satellite] Failed to fetch Street View for ${location}`, { error: error as Error });
            return null;
        }
    }

    /**
     * 👁️ Analyzes a Street View image using LLM Vision.
     * Uses structured SATELLITE_ANALYSIS_PROMPT template.
     */
    public async analyzeImage(imageBase64: string, companyName: string, address: string): Promise<SatelliteAnalysisResult> {
        // Build structured vision prompt from template
        const prompt = SATELLITE_ANALYSIS_PROMPT.template({
            companyName,
            address,
        });

        try {
            const rawResponse = await LLMService.completeVision(prompt, imageBase64);

            if (!rawResponse) {
                return { isCommercial: false, confidence: 0, buildingType: 'unknown', signageDetected: false, reason: 'Empty LLM response' };
            }

            const cleanJson = rawResponse.replace(/```json/g, '').replace(/```/g, '').trim();
            const result = JSON.parse(cleanJson);

            return {
                isCommercial: result.isCommercial,
                confidence: result.confidence,
                buildingType: result.type,
                signageDetected: result.signage,
                reason: result.reason
            };

        } catch (error) {
            Logger.error('[Satellite] Vision Analysis Failed', { error: error as Error });
            return { isCommercial: false, confidence: 0, buildingType: 'unknown', signageDetected: false, reason: 'Analysis Error' };
        }
    }
}
