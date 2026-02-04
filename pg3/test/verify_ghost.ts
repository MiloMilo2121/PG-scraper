
import { GhostHunter } from './src/core/discovery/ghost_hunter';
import { PromptManager, PromptStrategy } from './src/core/ai/prompt_manager';

async function verify() {
    console.log('👻 GHOST & 🧠 PROMPT VERIFICATION START');

    // 1. Ghost Hunter Check (Mock or Real)
    // We check a known archived URL (if internet matches). Or just unit test the method.
    const ghost = GhostHunter.getInstance();
    const deadUrl = 'http://example.com/dead-page';
    console.log(`Checking snapshot for ${deadUrl}...`);
    // This will likely return null without real internet or if URL is not archived, but logic runs.
    await ghost.checkSnapshot(deadUrl);
    console.log('✅ GhostHunter logic executed.');

    // 2. Prompt Manager Check
    const manager = PromptManager.getInstance();
    const prompt = manager.getValidationPrompt(PromptStrategy.CHAIN_OF_THOUGHT, { company_name: "Test It" });
    if (prompt.includes("Think Step-by-Step")) {
        console.log('✅ PromptManager returned Chain-of-Thought prompt.');
    } else {
        console.log('❌ PromptManager failed.');
    }

    console.log('👻 GHOST & 🧠 PROMPT VERIFICATION END');
}

verify();
