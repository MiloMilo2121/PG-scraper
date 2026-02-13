
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { UnifiedDiscoveryService } from '../../src/enricher/core/discovery/unified_discovery_service';
import { AgentRunner } from '../../src/enricher/core/agent/agent_runner';
import { CompanyMatcher } from '../../src/enricher/core/discovery/company_matcher';
import { BrowserFactory } from '../../src/enricher/core/browser/factory_v2';
import { ContentFilter } from '../../src/enricher/core/discovery/content_filter';
import { HoneyPotDetector } from '../../src/enricher/core/security/honeypot_detector';

// Mock dependencies
vi.mock('../../src/enricher/core/agent/agent_runner');
vi.mock('../../src/enricher/core/discovery/company_matcher');
vi.mock('../../src/enricher/core/browser/factory_v2');
vi.mock('../../src/enricher/core/discovery/content_filter');
vi.mock('../../src/enricher/core/security/honeypot_detector');
vi.mock('../../src/utils/scraper_client', () => ({
    ScraperClient: { isJinaEnabled: () => false, fetchHtml: vi.fn(), isScrapeDoEnabled: () => false } // Disable Jina for this test
}));
vi.mock('../../src/observability/antigravity_client', () => ({
    AntigravityClient: { getInstance: () => ({ trackCompanyUpdate: vi.fn() }) }
}));

describe('UnifiedDiscoveryService - Agent Integration', () => {
    let service: UnifiedDiscoveryService;
    let mockPage: any;

    beforeEach(() => {
        vi.clearAllMocks();

        // SERVICE SETUP
        service = new UnifiedDiscoveryService();

        // PAGE MOCK
        mockPage = {
            goto: vi.fn().mockResolvedValue(null),
            url: vi.fn().mockReturnValue('http://example.com'),
            content: vi.fn().mockResolvedValue('<html><body>Test Content</body></html>'),
            evaluate: vi.fn().mockImplementation((fn) => {
                // Basic implementation of extractPageEvidence default return
                return { text: 'Test Content', html: '<html>', title: 'Test Title', links: [] };
            }),
            setRequestInterception: vi.fn(),
            on: vi.fn(),
            removeAllListeners: vi.fn(),
        };

        // BROWSER FACTORY MOCK
        vi.mocked(BrowserFactory.getInstance).mockReturnValue({
            newPage: vi.fn().mockResolvedValue(mockPage),
            closePage: vi.fn(),
        } as any);

        // CONTENT FILTER MOCK (Pass validation)
        vi.mocked(ContentFilter.isDirectoryOrSocial).mockReturnValue(false);
        vi.mocked(ContentFilter.isValidContent).mockReturnValue({ valid: true, reason: 'ok' });
        vi.mocked(ContentFilter.isItalianLanguage).mockReturnValue(true);
        vi.mocked(ContentFilter.isDirectoryLikeTitle).mockReturnValue(false);


        // HONEYPOT MOCK (Safe)
        vi.mocked(HoneyPotDetector.getInstance).mockReturnValue({
            checkDNS: vi.fn().mockResolvedValue({ safe: true }),
            analyzeContent: vi.fn().mockReturnValue({ safe: true })
        } as any);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should TRIGGER AgentRunner when confidence is LOW (< 0.4) and > 0', async () => {
        // ARRANGE
        const company = { company_name: 'Low Conf Co', city: 'Milan' };

        // Mock Matcher to return low confidence
        vi.mocked(CompanyMatcher.evaluate).mockReturnValue({
            confidence: 0.35, // < 0.4 triggers agent
            reason: 'Weak match',
            signals: {} as any,
            scrapedVat: undefined,
            matchedPhone: undefined
        });

        vi.mocked(AgentRunner.run).mockResolvedValue('IT12345678901');

        // ACT
        // Calling verifyUrl triggers deepVerify
        const result = await service.verifyUrl('http://example.com', company);

        // ASSERT
        expect(AgentRunner.run).toHaveBeenCalledTimes(1);
        expect(result.confidence).toBe(0.95); // Agent boost
        expect(result.scraped_piva).toBe('IT12345678901');
    });

    it('should NOT trigger AgentRunner when confidence is HIGH (>= 0.4)', async () => {
        // ARRANGE
        const company = { company_name: 'High Conf Co', city: 'Milan' };

        // Mock Matcher to return acceptable confidence
        vi.mocked(CompanyMatcher.evaluate).mockReturnValue({
            confidence: 0.55, // >= 0.4 should NOT trigger agent
            reason: 'Okay match',
            signals: {} as any,
            scrapedVat: undefined,
            matchedPhone: undefined
        });

        // ACT
        const result = await service.verifyUrl('http://example.com', company);

        // ASSERT
        expect(AgentRunner.run).not.toHaveBeenCalled();
        expect(result.confidence).toBe(0.55);
    });

    it('should NOT trigger AgentRunner when confidence is 0 (Irrelevant)', async () => {
        // ARRANGE
        const company = { company_name: 'Zero Conf Co', city: 'Milan' };

        // Mock Matcher to return 0 confidence
        vi.mocked(CompanyMatcher.evaluate).mockReturnValue({
            confidence: 0.0,
            reason: 'No match',
            signals: {} as any,
            scrapedVat: undefined,
            matchedPhone: undefined
        });

        // ACT
        await service.verifyUrl('http://example.com', company);

        // ASSERT
        expect(AgentRunner.run).not.toHaveBeenCalled();
    });
});
