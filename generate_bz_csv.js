const axios = require('axios');
const fs = require('fs');
require('dotenv').config({ path: 'pg3/.env' });

async function run() {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new Error("No SERPER_API_KEY");

  let allPlaces = [];
  try {
      const res = await axios.post('https://google.serper.dev/places', {
        q: "agenzia immobiliare Padova",
        location: "Padua, Veneto, Italy",
        gl: "it",
        hl: "it"
      }, { headers: { 'X-API-KEY': apiKey } });

      if (res.data && res.data.places) {
          allPlaces = res.data.places.slice(0, 50);
      }
      
      let csv = "company_name,city,address\n";
      for (const p of allPlaces) {
          const name = p.title.replace(/,/g, '');
          const address = p.address ? p.address.replace(/,/g, '') : "Padova";
          csv += `${name},Padova,${address}\n`;
      }
      
      fs.writeFileSync('pg3/agenzie_padova.csv', csv);
      console.log(`Saved ${allPlaces.length} entries to pg3/agenzie_padova.csv`);
  } catch(e) {
      console.error(e.message);
  }
}
run();
