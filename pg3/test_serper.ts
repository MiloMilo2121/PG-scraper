const apiKey = process.env.SERPER_API_KEY;
fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey || '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: 'apple', gl: 'it', hl: 'it' })
}).then(async r => console.log(r.status, await r.text())).catch(console.error);
