import { ContentExtractor } from '../src/modules/extractor';

describe('ContentExtractor Module', () => {
    test('Extracts valid Italian VATs (Luhn check)', () => {
        // 12345678903 is valid (sums... wait, let's use a real one from online generators)
        // Example: 00743110157 (Eni)
        // Example: 00905811006 (Poste)
        const html = `
      <html><body>
         <p>P.IVA 00743110157</p>
         <p>VAT ID: 00905811006</p>
         <p>Bad VAT: 12345678901</p> 
         <p>Short: 123</p>
      </body></html>
    `;
        const res = ContentExtractor.extract(html, 'https://example.com');
        expect(res.vats).toContain('00743110157');
        expect(res.vats).toContain('00905811006');
        expect(res.vats).not.toContain('12345678901'); // Should fail Luhn
    });
});
