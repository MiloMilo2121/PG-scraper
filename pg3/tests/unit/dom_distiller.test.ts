
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DOMDistiller } from '../../src/enricher/core/agent/dom_distiller';

describe('DOMDistiller', () => {
    let mockPage: any;

    beforeEach(() => {
        mockPage = {
            evaluate: vi.fn(),
            title: vi.fn().mockResolvedValue('Test Page'),
            url: vi.fn().mockReturnValue('http://example.com')
        };
    });

    it('captures a snapshot using page.evaluate', async () => {
        // Mock the return value of the browser-side execution
        mockPage.evaluate.mockResolvedValue({
            title: 'Test Page',
            url: 'http://example.com',
            summary: '# Welcome\n[BTN id=1 ctx="Click Me"]',
            interactive: [
                { id: '1', tagName: 'button', text: 'Click Me', attributes: {}, xpath: '//button' }
            ]
        });

        const snapshot = await DOMDistiller.capture(mockPage);

        expect(snapshot.title).toBe('Test Page');
        expect(snapshot.url).toBe('http://example.com');
        expect(snapshot.interactive).toHaveLength(1);
        expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('handles errors gracefully', async () => {
        mockPage.evaluate.mockRejectedValue(new Error('Browser crash'));

        const snapshot = await DOMDistiller.capture(mockPage);

        expect(snapshot.title).toBe('Error');
        expect(snapshot.summary).toBe('');
        expect(snapshot.interactive).toEqual([]);
    });
});
