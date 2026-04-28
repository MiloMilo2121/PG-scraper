const { ProxyAgent, request } = require('undici');

async function run() {
  const proxyUrl = process.env.PROXY_RESIDENTIAL_URL;
  if (!proxyUrl) {
    throw new Error('PROXY_RESIDENTIAL_URL is required to run this proxy check');
  }
  const agent = new ProxyAgent({ uri: proxyUrl, requestTls: { rejectUnauthorized: false } });
  
  try {
    const res = await request('https://ipv4.icanhazip.com', { dispatcher: agent, bodyTimeout: 8000 });
    const text = await res.body.text();
    console.log("Success! Your residential IP is:", text.trim());
  } catch(e) {
    console.error("Failed:", e.message);
  }
}
run();
