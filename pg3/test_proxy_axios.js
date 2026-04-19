const { ProxyAgent, request } = require('undici');

async function run() {
  const proxyUrl = 'http://vfHrjaXd8Cn6x0h1:ZwNw3AK4mhv2hHPq@geo.iproyal.com:12321';
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
