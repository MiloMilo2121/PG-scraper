
import { GoogleSerpAnalyzer } from '../../src/core/discovery/serp_analyzer';
import { strict as assert } from 'assert';

console.log('🧪 Testing Parsers...');

const htmlMock = `
<html>
    <div class="g">
        <a href="https://example.com"><h3 class="LC20lb">Example Title</h3></a>
    </div>
</html>
`;

const res = GoogleSerpAnalyzer.parseSerp(htmlMock);
assert.equal(res.length > 0, true, 'Should find results');
assert.equal(res[0].url, 'https://example.com', 'Should extract URL');
assert.equal(res[0].title, 'Example Title', 'Should extract Title');

console.log('✨ Parser Tests Passed!');
