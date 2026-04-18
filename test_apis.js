const axios = require('axios');
require('dotenv').config({ path: './pg3/.env' });

const keys = {
    OPENAI: process.env.OPENAI_API_KEY,
    Z_AI: process.env.Z_AI_API_KEY,
    DEEPSEEK: process.env.DEEPSEEK_API_KEY,
    KIMI: process.env.KIMI_API_KEY,
    PERPLEXITY: process.env.PERPLEXITY_API_KEY,
    PROXY: process.env.PROXY_RESIDENTIAL_URL
};

async function testOpenAI() {
    if (!keys.OPENAI) return 'MISSING';
    try {
        const res = await axios.get('https://api.openai.com/v1/models', {
            headers: { Authorization: `Bearer ${keys.OPENAI}` }
        });
        return res.status === 200 ? 'OK' : `FAIL (${res.status})`;
    } catch (e) {
        return `ERROR: ${e.response?.status || e.message}`;
    }
}

async function testDeepSeek() {
    if (!keys.DEEPSEEK) return 'MISSING';
    try {
        const res = await axios.get('https://api.deepseek.com/models', {
            headers: { Authorization: `Bearer ${keys.DEEPSEEK}` }
        });
        return res.status === 200 ? 'OK' : `FAIL (${res.status})`;
    } catch (e) {
        return `ERROR: ${e.response?.status || e.message}`;
    }
}

async function testKimi() {
    if (!keys.KIMI) return 'MISSING';
    try {
        const res = await axios.get('https://api.moonshot.cn/v1/models', {
            headers: { Authorization: `Bearer ${keys.KIMI}` }
        });
        return res.status === 200 ? 'OK' : `FAIL (${res.status})`;
    } catch (e) {
        return `ERROR: ${e.response?.status || e.message}`;
    }
}

async function testPerplexity() {
    if (!keys.PERPLEXITY) return 'MISSING';
    try {
        const res = await axios.post('https://api.perplexity.ai/chat/completions', {
            model: 'sonar-pro',
            messages: [{ role: 'system', content: 'test' }, { role: 'user', content: 'hello' }]
        }, {
            headers: { Authorization: `Bearer ${keys.PERPLEXITY}` }
        });
        return res.status === 200 ? 'OK' : `FAIL (${res.status})`;
    } catch (e) {
        return `ERROR: ${e.response?.status || e.message}`;
    }
}

async function main() {
    console.log("Testing APIs...");
    console.log(`OpenAI: ${await testOpenAI()}`);
    console.log(`DeepSeek: ${await testDeepSeek()}`);
    console.log(`Kimi/Moonshot: ${await testKimi()}`);
    console.log(`Perplexity: ${await testPerplexity()}`);
    console.log(`ZhipuAI (Z_AI): ${keys.Z_AI ? 'PRESENT (Skipping request test)' : 'MISSING'}`);
    console.log(`Proxy (IPRoyal): ${keys.PROXY ? 'PRESENT' : 'MISSING'}`);
    console.log(`Serper: ${process.env.SERPER_API_KEY ? 'PRESENT' : 'MISSING'}`);
    console.log(`Jina: ${process.env.JINA_API_KEY ? 'PRESENT' : 'MISSING'}`);
}

main();
