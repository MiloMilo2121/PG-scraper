
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AgentBrain } from '../../src/enricher/core/agent/agent_brain';
import { LLMService } from '../../src/enricher/core/ai/llm_service';
import { ModelRouter } from '../../src/enricher/core/ai/model_router';
import { AGENT_NAVIGATION_PROMPT } from '../../src/enricher/core/ai/prompt_templates';
import { DOMSnapshot } from '../../src/enricher/core/agent/dom_distiller';

// Mock LLMService
vi.mock('../../src/enricher/core/ai/llm_service');

describe('AgentBrain', () => {

    const mockSnapshot: DOMSnapshot = {
        title: 'Test Page',
        url: 'https://test.com',
        summary: '...interactive elements...',
        interactive: []
    };

    const mockGoal = 'Find VAT';
    const mockHistory = ['Step 1: SCROLL -> Scrolled Down'];

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns a valid decision from LLM', async () => {
        const mockDecision = {
            thought: 'Found contact link',
            action: 'CLICK',
            target_id: '12',
        };
        const selectTaskChainSpy = vi.spyOn(ModelRouter, 'selectTaskChain').mockReturnValue(['agent-primary', 'agent-fallback']);
        const logTaskSelectionSpy = vi.spyOn(ModelRouter, 'logTaskSelection').mockImplementation(() => undefined);

        // Mock completeStructured
        vi.mocked(LLMService.completeStructured).mockResolvedValue(mockDecision);

        const decision = await AgentBrain.decide(mockSnapshot, mockGoal, mockHistory);

        expect(LLMService.completeStructured).toHaveBeenCalledTimes(1);
        expect(selectTaskChainSpy).toHaveBeenCalledWith('agent_navigation', { strictJson: true });
        expect(LLMService.completeStructured).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Object),
            'agent-primary',
            ['agent-fallback'],
            AGENT_NAVIGATION_PROMPT.system,
        );
        expect(logTaskSelectionSpy).toHaveBeenCalledWith('agent_navigation', { strictJson: true });
        expect(decision).toEqual(mockDecision);
    });

    it('handles null response from LLM', async () => {
        vi.mocked(LLMService.completeStructured).mockResolvedValue(null);

        const decision = await AgentBrain.decide(mockSnapshot, mockGoal, mockHistory);

        expect(decision).toEqual({
            thought: 'LLM returned null response',
            action: 'FAIL'
        });
    });

    it('handles exceptions during LLM call', async () => {
        vi.mocked(LLMService.completeStructured).mockRejectedValue(new Error('API Error'));

        const decision = await AgentBrain.decide(mockSnapshot, mockGoal, mockHistory);

        expect(decision).toEqual({
            thought: 'Error: API Error',
            action: 'FAIL'
        });
    });

    it('fails invalid EXTRACT decisions without extraction_key', async () => {
        vi.spyOn(ModelRouter, 'selectTaskChain').mockReturnValue(['agent-primary']);
        vi.spyOn(ModelRouter, 'logTaskSelection').mockImplementation(() => undefined);
        vi.mocked(LLMService.completeStructured).mockResolvedValue({
            thought: 'I found the VAT',
            action: 'EXTRACT',
        });

        const decision = await AgentBrain.decide(mockSnapshot, mockGoal, mockHistory);

        expect(decision).toEqual({
            thought: 'Invalid EXTRACT decision: missing extraction_key',
            action: 'FAIL'
        });
    });
});
