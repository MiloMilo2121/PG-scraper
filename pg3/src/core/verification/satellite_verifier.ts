
import axios from 'axios';
import { Logger } from '../../utils/logger';
import { config } from '../../config';

export interface SatelliteAnalysisResult {
    isCommercial: boolean;
    confidence: number;
    buildingType: 'commercial' | 'residential' | 'industrial' | 'empty' | 'unknown';
    signageDetected: boolean;
    reason: string;
}

export class SatelliteVerifier {
    private static instance: SatelliteVerifier;
    private readonly API_KEY = process.env.GOOGLE_STREET_VIEW_KEY;
    private readonly VISION_API_KEY = config.llm.apiKey; // Reuse OpenAI Key

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
        if (!this.API_KEY) {
            Logger.warn('[Satellite] No Google Street View API Key configured. Skipping.');
            return null;
        }

        const location = `${address}, ${city}, Italy`;
        const url = `https://maps.googleapis.com/maps/api/streetview?size=600x400&location=${encodeURIComponent(location)}&key=${this.API_KEY}`;

        try {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            return Buffer.from(response.data, 'binary').toString('base64');
        } catch (error) {
            Logger.error(`[Satellite] Failed to fetch Street View for ${location}`, error);
            return null;
        }
    }

    /**
     * Analyzes a Street View image using GPT-4o Vision to determine if it's a valid business.
     */
    public async analyzeImage(imageBase64: string, companyName: string): Promise<SatelliteAnalysisResult> {
        if (!this.VISION_API_KEY) return { isCommercial: false, confidence: 0, buildingType: 'unknown', signageDetected: false, reason: 'No Vision API Key' };

        try {
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: 'gpt-4o',
                    messages: [
                        {
                            role: 'system',
                            content: `You are an expert geospatial analyst. Analyze this Street View image.
                            Determine if the building at this location is a COMMERCIAL business or RESIDENTIAL/EMPTY.
                            Look for signage matching the company name: "${companyName}".
                            
                            Return valid JSON:
                            {
                                "isCommercial": boolean,
                                "type": "commercial" | "residential" | "industrial" | "empty",
                                "signage": boolean,
                                "confidence": number (0-1),
                                "reason": "short explanation"
                            }`
                        },
                        {
                            role: 'user',
                            content: [
                                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
                            ]
                        }
                    ],
                    max_tokens: 300
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.VISION_API_KEY}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const content = response.data.choices[0].message.content;
            const cleanJson = content.replace(/```json/g, '').replace(/```/g, '').trim();
            const result = JSON.parse(cleanJson);

            return {
                isCommercial: result.isCommercial,
                confidence: result.confidence,
                buildingType: result.type,
                signageDetected: result.signage,
                reason: result.reason
            };

        } catch (error) {
            Logger.error('[Satellite] Vision Analysis Failed', error);
            return { isCommercial: false, confidence: 0, buildingType: 'unknown', signageDetected: false, reason: 'Analysis Error' };
        }
    }
}
