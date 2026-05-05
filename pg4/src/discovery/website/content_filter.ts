/**
 * Pure functions for classifying URLs and HTML content. Ported from
 * pg3/src/enricher/core/discovery/content_filter.ts but exposed as plain
 * functions instead of a class.
 */

/**
 * Hosts that must NEVER be stored as `official_website`.
 *
 * Phase 3.7 audit of pg3 outputs (`MASTER_WITH_WEBSITE.csv`, 1700 rows)
 * found ~25% of records with `website` set to one of these. They polluted
 * downstream enrichment, decision-maker discovery, and final outreach
 * lists. See `docs/legacy_failure_taxonomy.md` §2.
 */
const DIRECTORIES = new Set([
  // Search engines — never the answer to "what's the company's website?"
  'google.com', 'google.it', 'bing.com', 'duckduckgo.com', 'lite.duckduckgo.com',

  // Italian phone / business directories
  'paginegialle.it', 'paginebianche.it', 'yelp.it', 'yelp.com', 'tripadvisor.it',

  // Social / messaging — including PG-generated "click to chat" surfaces
  'facebook.com', 'instagram.com', 'linkedin.com', 'linkedin.it', 'twitter.com', 'x.com',
  'wa.me', 'whatsapp.com', 'api.whatsapp.com', 'chat.whatsapp.com',
  't.me', 'telegram.me', 'linktr.ee', 'maps.app.goo.gl', 'g.page', 'm.me', 'messenger.com',

  // Italian aggregators / directory portals
  'virgilio.it', 'aziende.virgilio.it', 'kompass.com', 'europages.com',
  'misterimprese.it', 'prontopro.it', 'prontoimprese.it', 'habitissimo.it',

  // Job boards
  'infojobs.it', 'indeed.com', 'glassdoor.it', 'trovalavoro.it',
  'bakeca.it', 'subito.it',

  // Other portals + reference sites
  'wikipedia.org', 'amazon.it', 'ebay.it', 'groupon.it',

  // Italian business/registry portals
  'guidatitolari.it', 'registroimprese.it', 'ufficiocamerale.it',
  'informazione-aziende.it', 'trovanumeri.com', 'reteimprese.it', 'area-clienti.com',
  'pagineimprese.it',

  // Sales-intel / contact enrichment vendors
  'signalhire.com', 'rocketreach.co', 'zoominfo.com', 'apollo.io',
  'lusha.com', 'arounddeal.com', 'datanyze.com',

  // Italian B2B intel
  'companywall.it', 'visura.pro', 'registroaziende.it', 'wogha.com',
  'fatturatoitalia.it', 'saikoo.ai', 'reportaziende.it',

  // Real-estate listing portals (NEVER the agency's own website)
  'immobiliare.it', 'idealista.it', 'casa.it', 'tuttocitta.it',
  'soloaffitti.it', 'immobiliare.info', 'annuncicase.it', 'cercasicasa.it',
  'attico.it', 'wikicasa.it', 'caasa.it', 'trovacasa.it', 'cheannunci.it',

  // Real-estate FRANCHISE master portals (Phase 3.7 audit: 432/1700 records
  // were mistakenly tagged as the agency's website, when in fact they were
  // the franchise's flagship site, e.g. `tecnocasa.it/agenzie/foo`).
  'tecnocasa.it', 'gabetti.it', 'remax.it', 'professionecasa.it',
  'retecasa.it', 'intercasanet.it', 'myhomegroup.it', 'gruppocasa.com',
  'centrocasa.it', 'primacasa.it', 'stabilia.it', 'agenziagruppocasa.it',

  // News / classified / generic
  'money.it', 'guidamonaci.it', 'abbrevia.it', 'dnb.com', 'cloudfront.net',
]);

/** Italian directories from which we CAN extract structured data (different from pure social). */
const EXTRACTABLE_REGISTRIES = new Set([
  'fatturatoitalia.it', 'reportaziende.it', 'guidatitolari.it', 'visura.pro',
  'registroimprese.it', 'ufficiocamerale.it', 'paginegialle.it',
]);

const PARKING_KEYWORDS = [
  'domain is for sale', 'buy this domain', 'questo dominio è in vendita',
  'domain parked', 'godaddy', 'sedo', 'dan.com', 'afternic',
  'huge domains', 'domain name is available', 'acquista questo dominio',
  'is available for purchase', 'under verification',
];

const CONSTRUCTION_KEYWORDS = [
  'coming soon', 'lavori in corso', 'sito in manutenzione',
  'website under construction', 'stiamo arrivando', 'work in progress',
  'sito in allestimento', 'torneremo presto', 'sito in costruzione',
];

const ITALIAN_STOP_WORDS = [
  ' il ', ' lo ', ' la ', ' i ', ' gli ', ' le ',
  ' di ', ' a ', ' da ', ' in ', ' con ', ' su ', ' per ', ' tra ', ' fra ',
  ' è ', ' sono ', ' siamo ', ' azienda ', ' contatti ', ' chi siamo ',
  ' home ', ' servizi ', ' prodotti ',
];

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function isDirectoryOrSocial(url: string): boolean {
  const h = hostname(url);
  if (!h) return false;
  if (DIRECTORIES.has(h)) return true;
  // also match parent domains (e.g. blog.tecnocasa.it)
  for (const d of DIRECTORIES) {
    if (h.endsWith(`.${d}`)) return true;
  }
  return false;
}

export function isExtractableRegistry(url: string): boolean {
  const h = hostname(url);
  if (!h) return false;
  if (EXTRACTABLE_REGISTRIES.has(h)) return true;
  for (const d of EXTRACTABLE_REGISTRIES) {
    if (h.endsWith(`.${d}`)) return true;
  }
  return false;
}

export function isParked(htmlLower: string): boolean {
  return PARKING_KEYWORDS.some((kw) => htmlLower.includes(kw));
}

export function isUnderConstruction(htmlLower: string): boolean {
  return CONSTRUCTION_KEYWORDS.some((kw) => htmlLower.includes(kw));
}

export function isLikelyItalian(htmlLower: string): boolean {
  if (htmlLower.length < 200) return false;
  const matches = ITALIAN_STOP_WORDS.reduce((acc, sw) => acc + (htmlLower.includes(sw) ? 1 : 0), 0);
  return matches >= 4;
}
