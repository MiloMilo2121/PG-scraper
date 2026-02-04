
export class CapManager {
    public static async getMunicipalities(province: string): Promise<string[]> {
        // Mock DB of municipalities
        if (province === 'LO') return ['Lodi', 'Codogno', 'Casalpusterlengo'];
        return [];
    }
}
