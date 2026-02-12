
import { describe, expect, it, vi, beforeEach } from 'vitest';
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
});
