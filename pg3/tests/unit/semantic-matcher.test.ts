import { describe, expect, it } from 'vitest';
import { selectBestSemanticCandidate } from '../../src/enricher/core/discovery/hyperguesser_vx/semantic_matcher';

describe('semantic_matcher', () => {
    it('selects the guessed website when title/body/domain match the company', () => {
        const result = selectBestSemanticCandidate(
            {
                company_name: 'Gierre Immobiliare',
                city: 'Alessandria',
                province: 'AL',
                phone: '0131 123456',
            },
            [
                {
                    domain: 'gierreimmobiliare.com',
                    url: 'https://www.gierreimmobiliare.com/',
                    title: 'Gierre Immobiliare Alessandria',
                    text: 'Gierre Immobiliare opera ad Alessandria. Tel 0131123456. Intermediazione immobiliare.',
                },
                {
                    domain: 'agencywebexample.it',
                    url: 'https://agencywebexample.it/',
                    title: 'Agenzia Web',
                    text: 'Realizziamo siti internet e marketing digitale.',
                },
            ],
        );

        expect(result?.selected_url).toBe('https://www.gierreimmobiliare.com/');
        expect(result?.domain).toBe('gierreimmobiliare.com');
        expect(result?.confidence).toBeGreaterThanOrEqual(0.72);
    });

    it('rejects weak guessed domains with no semantic entity match', () => {
        const result = selectBestSemanticCandidate(
            {
                company_name: 'Miceli Immobiliare',
                city: 'Ribera',
                province: 'AG',
            },
            [
                {
                    domain: 'hostingexample.it',
                    url: 'https://hostingexample.it/',
                    title: 'Hosting Professionale',
                    text: 'Server, domini, cloud e registrazione siti.',
                },
            ],
        );

        expect(result).toBeNull();
    });
});
