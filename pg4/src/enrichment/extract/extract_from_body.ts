/**
 * Phase 1 (free-gold) — PURE extractor over an already-fetched website body.
 *
 * pg4 already HTTP-fetches a company's official website to VERIFY it
 * (direct_fetch → verify_candidates → VerifyVerdict.body on a strong
 * piva/phone match). That body is then used only for the paid-gate and
 * discarded. This module mines it for contact intelligence — email, PEC,
 * social profiles, P.IVA, extra phones — at ZERO marginal HTTP cost.
 *
 * Hard contract: PURE. No network, no router, no I/O, synchronous. Every
 * value is derived from the supplied HTML string. cheerio is the only dep
 * (already used by the financial parser and the Maps parser).
 *
 * Quality discipline (Italian SMB sites): emails are accepted only when
 * they sit on the firm's OWN registrable domain (rejects gmail/3rd-party/
 * directory addresses); PEC is split out by certified-mail domain; social
 * links must look like profile/company URLs, not share-intent widgets.
 */
import * as cheerio from 'cheerio';
import { extractVatCodesFromText } from '../financial/vat';

export interface BodyExtraction {
  /** Business email on the firm's own domain. */
  email?: string;
  /** Italian certified email (PEC), recognised by domain. */
  pec?: string;
  instagram?: string;
  facebook?: string;
  linkedin?: string;
  /** Checksum-valid P.IVA codes found in the page (footer/legal text). */
  vat_candidates: string[];
  /** Italian phone-shaped strings found on the page (normalised, deduped). */
  phones: string[];
}

const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi;
/** Certified-mail domains: @pec.*, @*.pec.it, @legalmail.it, @*.legalmail.it. */
const PEC_DOMAIN_RE = /@(?:[a-z0-9.\-]*\.)?(?:pec\.[a-z]{2,}|legalmail\.it|pec\.it)$/i;
/** Italian phone: optional +39, 0xx landline or 3xx mobile, with spacing. */
const PHONE_RE = /(?:\+39\s?)?(?:0\d{1,4}|3\d{2})[\s\-./]?\d[\d\s\-./]{4,12}\d/g;

/** Profile/company URL shapes per network; share/intent/plugin links rejected. */
const SOCIAL_PATTERNS: Array<{ key: 'instagram' | 'facebook' | 'linkedin'; host: RegExp; reject: RegExp }> = [
  { key: 'instagram', host: /(?:^|\.)instagram\.com$/i, reject: /\/(?:p|reel|explore|accounts|share)\b/i },
  { key: 'facebook', host: /(?:^|\.)facebook\.com$/i, reject: /\/(?:sharer|share|plugins|dialog|tr\b|events|photo)/i },
  { key: 'linkedin', host: /(?:^|\.)linkedin\.com$/i, reject: /\/(?:shareArticle|sharing|share-offsite|feed|posts)/i },
];

/**
 * Registrable domain heuristic: last two labels. Good enough for Italian
 * SMB sites (overwhelmingly `name.it` / `name.com`); intentionally simple
 * and dependency-free. Used only to decide "is this email on the firm's
 * own domain", a conservative filter — over-rejection is safe.
 */
export function registrableDomain(hostOrUrl: string | undefined | null): string | undefined {
  if (!hostOrUrl) return undefined;
  let host = String(hostOrUrl).trim().toLowerCase();
  host = host.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0].split('#')[0];
  if (!host || !host.includes('.')) return undefined;
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return undefined;
  return labels.slice(-2).join('.');
}

function emailDomain(email: string): string | undefined {
  const at = email.lastIndexOf('@');
  if (at < 0) return undefined;
  return registrableDomain(email.slice(at + 1));
}

/**
 * Extract contact intelligence from an already-fetched website body.
 * Never throws on malformed HTML (cheerio is forgiving); returns an empty
 * extraction (with `vat_candidates: []`, `phones: []`) when nothing is found.
 */
export function extractFromBody(html: string | undefined | null, lead: { official_website?: string }): BodyExtraction {
  const out: BodyExtraction = { vat_candidates: [], phones: [] };
  if (!html || html.length < 50) return out;

  const ownDomain = registrableDomain(lead.official_website);
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    return out; // unparseable — caller keeps whatever it had
  }

  // ---- Emails: mailto: hrefs first (highest-confidence), then body text ----
  const emailCandidates = new Set<string>();
  $('a[href^="mailto:" i]').each((_i, el) => {
    const href = $(el).attr('href') ?? '';
    const addr = href.replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
    if (addr.includes('@')) emailCandidates.add(addr);
  });
  const bodyText = $('body').length ? $('body').text() : $.root().text();
  for (const m of bodyText.matchAll(EMAIL_RE)) emailCandidates.add(m[0].toLowerCase());

  for (const addr of emailCandidates) {
    if (PEC_DOMAIN_RE.test(addr)) {
      if (!out.pec) out.pec = addr;
      continue;
    }
    // Business email must be on the firm's own registrable domain (when known).
    if (ownDomain && emailDomain(addr) !== ownDomain) continue;
    if (!out.email) out.email = addr;
  }
  // If we have no own-domain email but a PEC exists, that's still useful (kept).
  // If ownDomain is unknown, accept the first non-PEC address as a weak email.
  if (!out.email && !ownDomain) {
    for (const addr of emailCandidates) {
      if (!PEC_DOMAIN_RE.test(addr)) { out.email = addr; break; }
    }
  }

  // ---- Social profiles: scan all hrefs ----
  $('a[href]').each((_i, el) => {
    const href = ($(el).attr('href') ?? '').trim();
    if (!href || href.startsWith('#')) return;
    let host: string;
    let path: string;
    try {
      const u = new URL(href, lead.official_website ? `https://${registrableDomain(lead.official_website)}` : 'https://x.invalid');
      host = u.hostname.toLowerCase();
      path = u.pathname + u.search;
    } catch {
      return;
    }
    for (const pat of SOCIAL_PATTERNS) {
      if (out[pat.key]) continue;
      if (pat.host.test(host) && path.length > 1 && !pat.reject.test(path)) {
        // Normalise to a clean profile URL (strip query/hash).
        out[pat.key] = `https://${host.replace(/^www\./, '')}${path.split('?')[0].split('#')[0]}`.replace(/\/$/, '');
      }
    }
  });

  // ---- VAT: reuse the checksum-validated extractor (no false positives) ----
  out.vat_candidates = extractVatCodesFromText(bodyText);

  // ---- Phones: Italian-shaped, normalised, deduped ----
  const seenPhones = new Set<string>();
  // tel: hrefs are the cleanest source
  $('a[href^="tel:" i]').each((_i, el) => {
    const raw = ($(el).attr('href') ?? '').replace(/^tel:/i, '').trim();
    const norm = normalisePhone(raw);
    if (norm) seenPhones.add(norm);
  });
  for (const m of bodyText.matchAll(PHONE_RE)) {
    const norm = normalisePhone(m[0]);
    if (norm) seenPhones.add(norm);
  }
  out.phones = [...seenPhones];

  return out;
}

/**
 * Conservative Italian phone normalisation to a digit string with the
 * country prefix stripped (mirrors the deduper's phoneKey so downstream
 * dedup stays consistent). Returns undefined for implausible numbers.
 */
function normalisePhone(raw: string): string | undefined {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0039')) digits = digits.slice(4);
  else if (digits.length >= 11 && digits.startsWith('39')) digits = digits.slice(2);
  return digits.length >= 8 && digits.length <= 11 ? digits : undefined;
}
