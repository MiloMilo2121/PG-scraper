
import axios from 'axios';
import { config } from 'dotenv';
config();

const JINA_API_KEY = process.env.JINA_API_KEY;

if (!JINA_API_KEY) {
    console.error("❌ NO JINA API KEY FOUND");
    process.exit(1);
}

async function testJinaSearch() {
    const query = "Meccanica Rossi srl Milano sito ufficiale";
    const encodedQuery = encodeURIComponent(query);
    const url = `https://s.jina.ai/${encodedQuery}`;

    console.log(`🔎 Testing Jina Search: ${url}`);
    if (JINA_API_KEY) {
        console.log(`🔑 Key: ${JINA_API_KEY.substring(0, 10)}...`);
    }

    try {
        // Test 1: JSON Request
        console.log("\n--- TEST 1: Accept: application/json ---");
        const responseJson = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${JINA_API_KEY}`,
                'Accept': 'application/json',
                'X-Retain-Images': 'none'
            }
        });

        console.log("Status:", responseJson.status);
        console.log("Headers:", responseJson.headers['content-type']);
        const data = responseJson.data;
        console.log("Type of data:", typeof data);

        if (typeof data === 'object') {
            console.log("✅ JSON Object received");
            console.log("Keys:", Object.keys(data));
            if (data.data && Array.isArray(data.data)) {
                console.log(`✅ Data array found with ${data.data.length} items`);
                console.log("First item sample:", data.data[0]);
            } else {
                console.log("⚠️ Structue might be different than expected:", JSON.stringify(data).substring(0, 200));
            }
        } else {
            console.log("⚠️ Received string instead of object?");
            console.log(String(data).substring(0, 200));
        }

    } catch (error: any) {
        console.error("❌ Error in Test 1:", error.message);
        if (error.response) {
            console.error("Data:", error.response.data);
        }
    }
}

testJinaSearch();
