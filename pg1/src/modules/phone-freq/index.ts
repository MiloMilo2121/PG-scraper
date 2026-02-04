import { Normalizer } from '../normalizer';

export class PhoneFrequencyModel {
    private counts: Map<string, number> = new Map();

    track(phones: string[]) {
        for (const p of phones) {
            if (!p) continue;
            this.counts.set(p, (this.counts.get(p) || 0) + 1);
        }
    }

    getFrequency(phones: string[]): number {
        let maxFreq = 0;
        for (const p of phones) {
            const f = this.counts.get(p) || 0;
            if (f > maxFreq) maxFreq = f;
        }
        return maxFreq;
    }
}

export const phoneTracker = new PhoneFrequencyModel();
