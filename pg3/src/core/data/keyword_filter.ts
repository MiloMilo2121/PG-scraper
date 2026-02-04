
export class KeywordFilter {
    private static negativeKeywords = [
        'porn', 'adult', 'casino', 'gambling', 'escort',
        'dating', 'pharmacy', 'viagra', 'cialis',
        'hack', 'crack', 'warez'
    ];

    public static isSafe(text: string): boolean {
        const lower = text.toLowerCase();
        return !this.negativeKeywords.some(kw => lower.includes(kw));
    }
}
