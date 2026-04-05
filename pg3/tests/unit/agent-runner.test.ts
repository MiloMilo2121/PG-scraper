
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { AgentRunner } from '../../src/enricher/core/agent/agent_runner';
import { AgentBrain } from '../../src/enricher/core/agent/agent_brain';
import { DOMDistiller, DOMSnapshot } from '../../src/enricher/core/agent/dom_distiller';

// Mock dependencies
vi.mock('../../src/enricher/core/agent/agent_brain');
vi.mock('../../src/enricher/core/agent/dom_distiller');

describe('AgentRunner', () => {

    let mockPage: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockPage = {
            evaluate: vi.fn(),
            type: vi.fn(),
            click: vi.fn(),
        };
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('terminates successfully when DONE action is returned', async () => {
        const mockSnapshot: DOMSnapshot = {
            title: 'Test',
            url: 'http',
            summary: '...',
            interactive: []
        };
        vi.mocked(DOMDistiller.capture).mockResolvedValue(mockSnapshot);

        vi.mocked(AgentBrain.decide).mockResolvedValue({
            thought: 'Found it',
            action: 'DONE'
        });

        const result = await AgentRunner.run(mockPage, 'Goal');
        expect(result).toBe('Goal Achieved');
        expect(AgentBrain.decide).toHaveBeenCalledTimes(1);
    });

    it('executes CLICK action via page.evaluate', async () => {
        const mockSnapshot: DOMSnapshot = {
            title: 'Test',
            url: 'http',
            summary: '...',
            interactive: [{ id: '1', tagName: 'button', text: 'Click Me', attributes: {}, xpath: '//button' }]
        };
        vi.mocked(DOMDistiller.capture).mockResolvedValue(mockSnapshot);

        // Sequence: CLICK -> DONE
        vi.mocked(AgentBrain.decide)
            .mockResolvedValueOnce({ thought: 'Clicking', action: 'CLICK', target_id: '1' })
            .mockResolvedValueOnce({ thought: 'Done', action: 'DONE' });

        // Simulate successful click
        mockPage.evaluate.mockResolvedValue(true);

        await AgentRunner.run(mockPage, 'Goal');

        // AgentRunner uses page.evaluate to run click logic with XPath
        expect(mockPage.evaluate).toHaveBeenCalled();
        expect(AgentBrain.decide).toHaveBeenCalledTimes(2);
    });

    it('handles interaction failure (missing element)', async () => {
        const mockSnapshot: DOMSnapshot = {
            title: 'Test',
            url: 'http',
            summary: '...',
            interactive: [] // Element missing
        };
        vi.mocked(DOMDistiller.capture).mockResolvedValue(mockSnapshot);

        vi.mocked(AgentBrain.decide)
            .mockResolvedValue({ thought: 'Clicking ghost', action: 'CLICK', target_id: '99' });

        // Agent should loop, retry, or fail. Since MAX_STEPS is 15, let's limit the test run
        // We override run logic slightly or just check if it handles the error string
        // Actually, executeAction returns a string. The loop continues.
        // We can just spy on executeAction? No, it's private.
        // Let's just run one step and FAIL on second step to break loop

        vi.mocked(AgentBrain.decide)
            .mockResolvedValueOnce({ thought: 'Clicking ghost', action: 'CLICK', target_id: '99' })
            .mockResolvedValueOnce({ thought: 'Giving up', action: 'FAIL' });

        const result = await AgentRunner.run(mockPage, 'Goal');
        expect(result).toBeNull(); // FAIL returns null
    });

    it('terminates on FAIL action', async () => {
        const mockSnapshot: DOMSnapshot = { title: 'Test', url: 'http', summary: '...', interactive: [] };
        vi.mocked(DOMDistiller.capture).mockResolvedValue(mockSnapshot);

        vi.mocked(AgentBrain.decide).mockResolvedValue({
            thought: 'Giving up',
            action: 'FAIL'
        });

        const result = await AgentRunner.run(mockPage, 'Goal');
        expect(result).toBeNull();
    });

    it('returns the extraction key only after EXTRACT followed by DONE', async () => {
        const mockSnapshot: DOMSnapshot = {
            title: 'Test',
            url: 'http',
            summary: 'VAT 123 visible',
            interactive: []
        };
        vi.mocked(DOMDistiller.capture).mockResolvedValue(mockSnapshot);

        vi.mocked(AgentBrain.decide)
            .mockResolvedValueOnce({ thought: 'Capture the VAT marker', action: 'EXTRACT', extraction_key: 'vat_number' })
            .mockResolvedValueOnce({ thought: 'Done', action: 'DONE' });

        const result = await AgentRunner.run(mockPage, 'Goal');
        expect(result).toBe('vat_number');
        expect(AgentBrain.decide).toHaveBeenCalledTimes(2);
    });

    it('aborts deterministic loops when the same action repeats on the same page', async () => {
        vi.useFakeTimers();

        const mockSnapshot: DOMSnapshot = {
            title: 'Test',
            url: 'http://same-page',
            summary: 'same summary',
            interactive: [{ id: '1', tagName: 'button', text: 'Click Me', attributes: {}, xpath: '//button' }]
        };
        vi.mocked(DOMDistiller.capture).mockResolvedValue(mockSnapshot);
        vi.mocked(AgentBrain.decide).mockResolvedValue({
            thought: 'Click again',
            action: 'CLICK',
            target_id: '1'
        });
        mockPage.evaluate.mockResolvedValue(true);

        const runPromise = AgentRunner.run(mockPage, 'Goal');
        await vi.advanceTimersByTimeAsync(5000);
        const result = await runPromise;

        expect(result).toBeNull();
        expect(AgentBrain.decide).toHaveBeenCalledTimes(3);
    });

    it('stops after too many scroll attempts on the same page state', async () => {
        vi.useFakeTimers();

        const mockSnapshot: DOMSnapshot = {
            title: 'Infinite Scroll',
            url: 'http://same-page',
            summary: 'unchanged summary',
            interactive: []
        };
        vi.mocked(DOMDistiller.capture).mockResolvedValue(mockSnapshot);
        vi.mocked(AgentBrain.decide).mockResolvedValue({
            thought: 'Need more content',
            action: 'SCROLL'
        });

        const runPromise = AgentRunner.run(mockPage, 'Goal');
        await vi.advanceTimersByTimeAsync(7000);
        const result = await runPromise;

        expect(result).toBeNull();
        expect(AgentBrain.decide).toHaveBeenCalledTimes(4);
    });
});
