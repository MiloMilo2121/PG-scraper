import axios from 'axios';
import { CandidateMiner } from '../src/modules/miner';
import { GoogleCustomSearchProvider, GoogleSearchProviderError } from '../src/modules/miner/provider';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Google Custom Search provider', () => {
    beforeEach(() => {
        mockedAxios.get.mockReset();
    });

    it('surfaces rate limits as retriable provider errors', async () => {
        mockedAxios.get.mockRejectedValueOnce({
            message: 'Request failed with status code 429',
            response: {
                status: 429,
                data: {
                    error: {
                        message: 'Rate limit exceeded',
                    },
                },
            },
        });

        const provider = new GoogleCustomSearchProvider('key', 'cx');

        await expect(provider.search('query')).rejects.toMatchObject({
            name: 'GoogleSearchProviderError',
            kind: 'rate_limit',
            retriable: true,
            statusCode: 429,
        });
    });

    it('surfaces empty results explicitly instead of collapsing them to []', async () => {
        mockedAxios.get.mockResolvedValueOnce({
            status: 200,
            data: {
                items: [],
            },
        });

        const provider = new GoogleCustomSearchProvider('key', 'cx');

        await expect(provider.search('query')).rejects.toMatchObject({
            name: 'GoogleSearchProviderError',
            kind: 'empty_result',
            retriable: false,
        });
    });
});

describe('CandidateMiner fallback policy', () => {
    it('continues only on retriable failures and then uses fallback queries', async () => {
        const search = jest
            .fn()
            .mockRejectedValueOnce(new GoogleSearchProviderError('network', 'temporary network issue', { retriable: true }))
            .mockResolvedValueOnce([
                {
                    url: 'https://example.com',
                    title: 'Example',
                    snippet: 'Example snippet',
                },
            ])
            .mockResolvedValueOnce([]);

        const miner = new CandidateMiner({
            name: 'GoogleCS',
            search,
        } as any);

        const candidates = await miner.mine({
            company_name: 'ACME',
            city: 'Milano',
        } as any);

        expect(search).toHaveBeenCalledTimes(3);
        expect(candidates).toHaveLength(1);
        expect(candidates[0].source_url).toBe('https://example.com');
    });

    it('stops and surfaces non-retriable failures', async () => {
        const search = jest
            .fn()
            .mockRejectedValueOnce(new GoogleSearchProviderError('bad_request', 'bad query', { retriable: false }));

        const miner = new CandidateMiner({
            name: 'GoogleCS',
            search,
        } as any);

        await expect(
            miner.mine({
                company_name: 'ACME',
                city: 'Milano',
            } as any),
        ).rejects.toBeInstanceOf(GoogleSearchProviderError);

        expect(search).toHaveBeenCalledTimes(1);
    });
});
