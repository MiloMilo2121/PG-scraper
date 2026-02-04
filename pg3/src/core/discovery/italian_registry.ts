export class ItalianRegistrySearch {
    static async extractFromRegistryPage(url: string): Promise<{ website?: string }> {
        return { website: '' };
    }
}
