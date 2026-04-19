require('dotenv').config({ path: '.env' });
const fs = require('fs');

const SERPER_KEY = process.env.SERPER_API_KEY;

// Categoria Pagine Gialle-style + aree geografiche target
const QUERIES = [
  // Laboratori alimentari
  { q: 'laboratorio analisi alimenti Mantova', city: 'Mantova' },
  { q: 'laboratorio analisi alimenti Brescia', city: 'Brescia' },
  { q: 'laboratorio alimentare Verona', city: 'Verona' },
  // Food packaging / imballaggi alimentari
  { q: 'imballaggi alimentari packaging Mantova', city: 'Mantova' },
  { q: 'azienda packaging alimentare Brescia', city: 'Brescia' },
  { q: 'imballaggi alimentari Verona', city: 'Verona' },
  { q: 'packaging alimentare Legnago', city: 'Legnago' },
  // Industria alimentare / Produzione alimenti
  { q: 'industria alimentare Mantova', city: 'Mantova' },
  { q: 'produzione alimenti Brescia', city: 'Brescia' },
  { q: 'stabilimento alimentare Verona Sud', city: 'Verona' },
  // Macellerie industriali / salumifici
  { q: 'salumificio Mantova', city: 'Mantova' },
  { q: 'salumificio Brescia', city: 'Brescia' },
  { q: 'macelleria industriale Verona', city: 'Verona' },
  // Mulini / Pastifici
  { q: 'pastificio Mantova', city: 'Mantova' },
  { q: 'pastificio Brescia', city: 'Brescia' },
  // Magazzini / Frigoriferi / Depositi alimentari
  { q: 'magazzino frigo alimenti Mantova', city: 'Mantova' },
  { q: 'deposito alimentare Brescia', city: 'Brescia' },
  { q: 'cella frigorifera Verona', city: 'Verona' },
  // Ristoranti/mense collettività (grandi)
  { q: 'mensa aziendale catering Mantova', city: 'Mantova' },
  { q: 'catering mensa Brescia', city: 'Brescia' },
  { q: 'catering industriale Verona', city: 'Verona' },
  // Granai / cereali / agro-industria
  { q: 'silos cereali stoccaggio Mantova', city: 'Mantova' },
  { q: 'cooperativa agricola Brescia', city: 'Brescia' },
  { q: 'molino mulino Mantova', city: 'Mantova' },
  // Supermercati / GDO
  { q: 'supermercato distribuzione alimentare Legnago Verona', city: 'Legnago' },
];

async function searchPlaces(query, city) {
  const res = await fetch('https://google.serper.dev/places', {
    method: 'POST',
    headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, gl: 'it', hl: 'it' })
  });
  const data = await res.json();
  if (!data.places) return [];
  return data.places.slice(0, 6).map(p => ({
    company_name: p.title,
    city: city,
    address: p.address || city,
    query_category: query
  }));
}

async function main() {
  console.log(`🔍 Generando dataset pest-control targets: ${QUERIES.length} query...`);
  const all = [];
  const seen = new Set();

  for (const { q, city } of QUERIES) {
    try {
      const results = await searchPlaces(q, city);
      for (const r of results) {
        const key = r.company_name.toLowerCase().trim();
        if (!seen.has(key)) {
          seen.add(key);
          all.push(r);
        }
      }
      console.log(`  ✅ "${q}" -> ${results.length} risultati (tot: ${all.length})`);
    } catch(e) {
      console.error(`  ❌ Errore su "${q}": ${e.message}`);
    }
    // Small rate-limit delay
    await new Promise(r => setTimeout(r, 250));
  }

  // Write CSV
  const header = 'company_name,city,address,query_category\n';
  const rows = all.map(r => {
    const name = (r.company_name || '').replace(/,/g, '').replace(/"/g, '');
    const city = (r.city || '').replace(/,/g, '');
    const addr = (r.address || '').replace(/,/g, '');
    const cat = (r.query_category || '').replace(/,/g, '');
    return `"${name}","${city}","${addr}","${cat}"`;
  });

  const csv = header + rows.join('\n');
  fs.writeFileSync('pest_control_targets.csv', csv);
  console.log(`\n✅ DATASET COMPLETATO: ${all.length} aziende uniche salvate in pest_control_targets.csv`);
}

main().catch(console.error);
