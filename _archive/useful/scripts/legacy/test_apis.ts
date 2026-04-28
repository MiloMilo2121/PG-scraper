import 'dotenv/config';
import axios from 'axios';

async function checkOpenAI() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return 'MISSING';
    const modelsToTest = ['gpt-5-mini', 'gpt-4o-mini', 'gpt-5-mini-2025-08-07'];
    
    for (const model of modelsToTest) {
        try {
            const res = await axios.post('https://api.openai.com/v1/chat/completions', {
                model: model,
                messages: [{role: "user", content: "hi"}],
                max_tokens: 5
            }, {
                headers: { Authorization: `Bearer ${apiKey}` }
            });
            return `SUCCESS (${model})`;
        } catch (e: any) {
            if (e.response?.status === 401) return `ERROR: 401 Unauthorized`;
            if (e.response?.status === 429) return `ERROR: 429 Insufficient Quota`;
        }
    }
    return 'ERROR: No matching model found or other API error';
}

async function checkDeepSeek() {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return 'MISSING';
    try {
        const res = await axios.post('https://api.deepseek.com/chat/completions', {
            model: "deepseek-chat",
            messages: [{role: "user", content: "hi"}],
            max_tokens: 5
        }, {
            headers: { Authorization: `Bearer ${apiKey}` }
        });
        return `SUCCESS (deepseek-chat)`;
    } catch (e: any) {
        return `ERROR: ${e.response?.status || e.response?.data?.error?.message || e.message}`;
    }
}

async function checkKimi() {
    const apiKey = process.env.KIMI_API_KEY;
    if (!apiKey) return 'MISSING';
    const modelsToTest = ['moonshot-v1-8k', 'moonshot-v1-auto', 'kimi-k2.5'];
    
    for (const model of modelsToTest) {
        try {
            const res = await axios.post('https://api.moonshot.cn/v1/chat/completions', {
                model: model,
                messages: [{role: "user", content: "hi"}],
                max_tokens: 5
            }, {
                headers: { Authorization: `Bearer ${apiKey}` }
            });
            return `SUCCESS (${model})`;
        } catch (e: any) {
            if (e.response?.status === 401) return `ERROR: 401 Unauthorized`;
            if (e.response?.status === 402 || e.response?.status === 429) return `ERROR: Insufficient Balance/Quota`;
        }
    }
    return 'ERROR: No matching model found or other API error';
}

async function checkZhiPu() {
    const apiKey = process.env.Z_AI_API_KEY;
    if (!apiKey) return 'MISSING';
    
    const modelsToTest = ['glm-4.7-flash', 'glm-4-flash', 'zai/glm-4.7-flash'];
    for (const model of modelsToTest) {
        try {
            const res = await axios.post('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
                model: model,
                messages: [{role: "user", content: "hi"}],
                max_tokens: 5
            }, {
                headers: { Authorization: `Bearer ${apiKey}` }
            });
            return `SUCCESS (${model})`;
        } catch (e: any) {
            if (e.response?.status === 401) return `ERROR: 401 Unauthorized`;
            if (e.response?.status === 402 || e.response?.status === 429) return `ERROR: Insufficient Balance/Quota`;
        }
    }
    return 'ERROR: No matching model found or other API error';
}

async function checkProxy() {
    const proxyUrl = process.env.PROXY_RESIDENTIAL_URL;
    if (!proxyUrl) return 'MISSING';
    
    try {
        const urlObj = new URL(proxyUrl);
        const res = await axios.get('https://api.ipify.org?format=json', {
            proxy: {
                protocol: urlObj.protocol.replace(':', ''),
                host: urlObj.hostname,
                port: Number(urlObj.port),
                auth: {
                    username: decodeURIComponent(urlObj.username),
                    password: decodeURIComponent(urlObj.password)
                }
            },
            timeout: 10000
        });
        return `SUCCESS (IP: ${res.data.ip})`;
    } catch (e: any) {
        return `ERROR: ${e.message}`;
    }
}


async function run() {
    console.log("=== API & PROXY KEY AUDIT ===");
    
    const results = {
        OPENAI: await checkOpenAI(),
        DEEPSEEK: await checkDeepSeek(),
        KIMI: await checkKimi(),
        ZHIPU_GLM: await checkZhiPu(),
        PROXY_IPROYAL: await checkProxy()
    };
    
    console.table(results);
}

run();
