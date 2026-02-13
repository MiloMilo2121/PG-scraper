
require('dotenv').config();
const key = process.env.OPENAI_API_KEY;
if (!key) {
    console.log("❌ OPENAI_API_KEY is missing/undefined");
} else {
    console.log(`✅ OPENAI_API_KEY found.`);
    console.log(`   Length: ${key.length}`);
    console.log(`   Starts with: '${key.substring(0, 3)}'`);
    console.log(`   Ends with: '${key.substring(key.length - 3)}'`);
    console.log(`   Contains quotes? ${key.includes('"') || key.includes("'")}`);
    console.log(`   Contains whitespace? ${/\s/.test(key)}`);
}
