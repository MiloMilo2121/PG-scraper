/**
 * Pure functions for classifying URLs and HTML content. Ported from
 * pg3/src/enricher/core/discovery/content_filter.ts but exposed as plain
 * functions instead of a class.
 */

const DIRECTORIES = new Set([
  'paginegialle.it', 'paginebianche.it', 'yelp.it', 'yelp.com', 'tripadvisor.it',
  'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com',
  'wa.me', 'whatsapp.com', 'api.whatsapp.com', 'chat.whatsapp.com',
  't.me', 'telegram.me', 'linktr.ee', 'maps.app.goo.gl', 'g.page',
  'virgilio.it', 'aziende.virgilio.it', 'kompass.com', 'europages.com',
  'misterimprese.it', 'prontopro.it', 'prontoimprese.it', 'habitissimo.it',
  'infojobs.it', 'indeed.com', 'glassdoor.it', 'trovalavoro.it',
  'bakeca.it', 'subito.it', 'wikipedia.org', 'amazon.it', 'ebay.it', 'groupon.it',
  'guidatitolari.it', 'registroimprese.it', 'ufficiocamerale.it',
  'informazione-aziende.it', 'trovanumeri.com', 'reteimprese.it', 'area-clienti.com',
  'pagineimprese.it', 'linkedin.it', 'signalhire.com', 'rocketreach.co',
  'zoominfo.com', 'apollo.io', 'lusha.com', 'arounddeal.com', 'datanyze.com',
  'companywall.it', 'visura.pro', 'registroaziende.it', 'wogha.com',
  'fatturatoitalia.it', 'saikoo.ai', 'reportaziende.it',
  'trovacasa.it', 'cheannunci.it', 'money.it', 'guidamonaci.it', 'abbrevia.it',
  'immobiliare.it', 'idealista.it', 'casa.it', 'tuttocitta.it', 'dnb.com',
  'cloudfront.net', 'soloaffitti.it', 'tecnocasa.it', 'immobiliare.info',
  'annuncicase.it', 'cercasicasa.it', 'attico.it', 'wikicasa.it', 'caasa.it',
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
