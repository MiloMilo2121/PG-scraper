
import { SelectorRegistry } from './src/core/resilience/selector_registry';
import { GoogleSerpAnalyzer } from './src/core/discovery/serp_analyzer';

// Mock bad selector
const registry = SelectorRegistry.getInstance();
registry.update('google', 'result_link', '.broken-selector-that-doesnt-exist'); // 😈 Sabotage

const MOCK_HTML = `
<html>
<body>
    <div class="main-search-results">
        <div class="g">
            <!-- This is the real structure we want the AI to find -->
            <div class="result-container">
                <a href="https://example.com" class="actual-link"><h3>Example Domain</h3></a>
                <div class="snippet">Description here...</div>
            </div>
            <div class="result-container">
                <a href="https://test.com" class="actual-link"><h3>Test Site</h3></a>
            </div>
        </div>
    </div>
</body>
</html>
`;

async function verify() {
    console.log('🩹 HEALER VERIFICATION START');

    console.log('1. Current Selector (Sabotaged):', registry.get('google', 'result_link'));
    console.log('2. Running Analyzer on Mock HTML...');

    // This should trigger the healer because '.broken-selector...' won't match anything
    const results = await GoogleSerpAnalyzer.parseSerp(MOCK_HTML);

    console.log('3. Results Found:', results.length);
    if (results.length > 0) {
        console.log('✅ HEALER WORKED! It found results despite broken config.');
        console.log('4. New Selector Saved:', registry.get('google', 'result_link'));
    } else {
        console.log('❌ HEALER FAILED.');
    }

    console.log('🩹 HEALER VERIFICATION END');
}

verify();
