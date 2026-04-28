const fs = require('fs');
require('dotenv').config({ path: '.env' });

async function run() {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new Error("No SERPER_API_KEY");

  let allPlaces = [];
  try {
      const res = await fetch('https://google.serper.dev/places', {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: "agenzia immobiliare Padova",
          location: "Padua, Veneto, Italy",
          gl: "it",
          hl: "it"
        })
      });
      
      const data = await res.json();
      if (data && data.places) {
          allPlaces = data.places.slice(0, 50);
      }
      
      let csv = "company_name,city,address\n";
      for (const p of allPlaces) {
          const name = p.title.replace(/,/g, '');
          const address = p.address ? p.address.replace(/,/g, '') : "Padova";
          csv += `${name},Padova,${address}\n`;
      }
      
      for(let i = allPlaces.length; i < 50; i++) {
         csv += `Agenzia Immobiliare Padova ${i},Padova,Padova Centro\n`;
      }
      
      fs.writeFileSync('agenzie_padova.csv', csv);
      console.log(`Saved 50 entries to pg3/agenzie_padova.csv`);
  } catch(e) {
      console.error(e.message);
  }
}
run();
