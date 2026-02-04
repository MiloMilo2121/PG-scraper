
export class AddressNormalizer {
    public static normalize(address: string): string {
        return address
            .replace(/\bVia\b/gi, 'Via')
            .replace(/\bPiazza\b/gi, 'Piazza')
            .replace(/\bC\.so\b/gi, 'Corso')
            .replace(/\bV\.le\b/gi, 'Viale')
            .replace(/\s+/g, ' ')
            .trim();
    }
}
