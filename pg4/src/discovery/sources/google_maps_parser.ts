import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { Lead } from '../../types/lead';

type CheerioCard = cheerio.Cheerio<AnyNode>;

/**
 * Pure parser for Google Maps result-feed HTML.
 *
 * Selectors follow `pg3/src/scraper/providers/maps_grid_provider.ts`:
 *   - `div[role="feed"]`              → feed container
 *   - `div.Nv2PK`                     → result card root
 *   - `.qBF1Pd`, `div.fontHeadlineSmall`, or `a[aria-label]` → name
 *   - `.W4Efsd span`                  → mixed info spans (address + phone + tags)
 *   - `a[data-value="Sito web"]`,
 *     `a[aria-label*="sito web" i]`,
 *     `a[aria-label*="Website" i]`    → website
 *   - `.MW4etd`                       → rating
 *
 * The feed mixes signal types (rating, status, address, phone) into bare
 * `<span>` siblings — we type each span by regex to extract address vs phone.
 */

export interface MapsParseResult {
  results: Lead[];
  total_cards: number;
  dropped: number;
}

const ADDRESS_PREFIX_RE = /^(Via|Viale|Piazza|Corso|Largo|Vicolo|Strada(?:\s+Provinciale)?|Loc\.|C\.so|P\.za|V\.le)\b/i;
const ADDRESS_FALLBACK_RE = /\d{5}/;        // any 5-digit ZIP token
const PHONE_RE = /^(?:\+39\s?)?(?:0\d{1,4}|3\d{2})\s?\d[\d\s\-./]{4,15}$/;

export function parseGoogleMapsResults(
  html: string,
  opts: { category?: string; cityHint?: string } = {}
): MapsParseResult {
  if (!html || html.length < 100) return { results: [], total_cards: 0, dropped: 0 };
  const $ = cheerio.load(html);
  const feed = $('div[role="feed"]').first();
  if (!feed.length) return { results: [], total_cards: 0, dropped: 0 };

  const cards = feed.find('div.Nv2PK').toArray();
  const out: Lead[] = [];

  for (const cardEl of cards) {
    const $card = $(cardEl);
    const lead = parseCard($card, opts);
    if (lead) out.push(lead);
  }
  return { results: out, total_cards: cards.length, dropped: cards.length - out.length };
}

function parseCard($card: CheerioCard, opts: { category?: string; cityHint?: string }): Lead | undefined {
  // Name: try .qBF1Pd, then .fontHeadlineSmall, then a[aria-label]
  const nameFromHeadline = collapse($card.find('.qBF1Pd, div.fontHeadlineSmall').first().text());
  const nameFromAria = collapse($card.find('a[aria-label]').first().attr('aria-label') ?? '');
  const name = nameFromHeadline || nameFromAria;
  if (!name) return undefined;

  // Maps card URL — first <a> with href that looks like a place link
  let mapsUrl: string | undefined;
  $card.find('a[href*="/maps/place/"]').each((_i, el) => {
    if (mapsUrl) return false;
    const href = $card.find(el).attr('href');
    if (href) mapsUrl = href.startsWith('http') ? href : `https://www.google.com${href}`;
    return false;
  });

  // Info spans — classify each as address / phone / noise
  let address: string | undefined;
  let phone: string | undefined;
  $card.find('.W4Efsd span').each((_i, el) => {
    const txt = collapse($card.find(el).text());
    if (!txt) return;
    if (!address && (ADDRESS_PREFIX_RE.test(txt) || /^\d+,\s/.test(txt) || ADDRESS_FALLBACK_RE.test(txt))) {
      address = txt;
      return;
    }
    if (!phone && PHONE_RE.test(txt)) {
      phone = txt;
    }
  });

  // Address parsing: Maps usually formats "Via X 1, 32100 Comune BL"
  let zip: string | undefined;
  let city: string | undefined;
  let province: string | undefined;
  if (address) {
    const zipMatch = address.match(/\b(\d{5})\b/);
    if (zipMatch) zip = zipMatch[1];
    // Try "ZIP City PV" or "ZIP City (PV)"
    const cityMatch =
      address.match(/\d{5}\s+([^()]+?)\s+([A-Z]{2})\b/) ||
      address.match(/\d{5}\s+([^()]+?)\s*\(([A-Z]{2})\)/);
    if (cityMatch) {
      city = cityMatch[1].trim();
      province = cityMatch[2];
    }
  }
  if (!city && opts.cityHint) city = opts.cityHint;

  // Website
  let website: string | undefined;
  const websiteSelectors = ['a[data-value="Sito web"]', 'a[aria-label*="sito web" i]', 'a[aria-label*="Website" i]'];
  for (const sel of websiteSelectors) {
    const href = $card.find(sel).first().attr('href');
    if (href && href.startsWith('http')) {
      website = href;
      break;
    }
  }

  const lead: Lead = { company_name: name, source: 'MAPS' };
  if (opts.category) lead.category = opts.category;
  if (address) lead.address = address;
  if (zip) lead.zip_code = zip;
  if (city) lead.city = city;
  if (province) lead.province = province;
  if (phone) lead.phone = phone;
  if (website) lead.website = website;
  if (mapsUrl) {
    lead.maps_url = mapsUrl;
    lead.source_url = mapsUrl;
  }
  return lead;
}

function collapse(s: string | undefined | null): string {
  if (!s) return '';
  return s.replace(/[\s ]+/g, ' ').trim();
}
