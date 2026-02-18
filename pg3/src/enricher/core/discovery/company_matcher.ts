import { CompanyInput } from '../../types';

export interface MatchSignals {
  vatMatch: boolean;
  phoneMatch: boolean;
  nameCoverage: number;
  cityMatch: boolean;
  addressCoverage: number;
  domainCoverage: number;
  hasContactKeywords: boolean;
  ogImageMatch?: boolean;
}

export interface MatchEvaluation {
  confidence: number;
  reason: string;
  signals: MatchSignals;
  scrapedVat?: string;
  matchedPhone?: string;
}

const LEGAL_SUFFIXES = new Set([
  'srl',
  'srls',
  'spa',
  'snc',
  'sas',
  'sapa',
  'societa',
  'ditta',
  'impresa',
  'soc',
  'co',
  'ltd',
  'llc',
  'inc',
  'group',
  'holding',
  'the',
  'and',
  'di',
  'dei',
  'della',
  'delle',
  'del',
  'de',
  'e',
]);

const ADDRESS_NOISE = new Set([
  'via',
  'viale',
  'piazza',
  'pzza',
  'corso',
  'strada',
  's',
  'snc',
  'n',
  'nr',
  'numero',
  'interno',
  'int',
]);

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);
}

function getVatFromCompany(company: CompanyInput): string {
  const vat = company.vat_code || company.piva || company.vat || '';
  return vat.replace(/\D/g, '');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class CompanyMatcher {
  public static evaluate(company: CompanyInput, url: string, text: string, title: string = ''): MatchEvaluation {
    const normalizedText = normalizeText(text);
    const normalizedTitle = normalizeText(title);

    const targetVat = getVatFromCompany(company);
    const vatCandidates = this.extractVatNumbers(text);
    const matchedVat = targetVat && vatCandidates.includes(targetVat) ? targetVat : undefined;
    const vatMatch = !!matchedVat;
    if (vatMatch) {
      return {
        confidence: 0.95, // GOLDEN SIGNAL
        reason: 'VAT match (Golden Signal)',
        scrapedVat: matchedVat,
        signals: {
          vatMatch: true,
          phoneMatch: false,
          nameCoverage: 1,
          cityMatch: false,
          addressCoverage: 0,
          domainCoverage: this.domainCoverage(company.company_name, url),
          hasContactKeywords: this.hasContactKeywords(normalizedText, normalizedTitle),
          ogImageMatch: false,
        },
      };
    }

    const targetPhone = this.normalizePhone(company.phone);
    const phonesFound = this.extractPhones(text);
    const matchedPhone = this.findMatchingPhone(targetPhone, phonesFound);
    const phoneMatch = !!matchedPhone;

    const nameCoverage = this.nameCoverage(company.company_name, normalizedText);
    const cityMatch = this.cityMatch(company.city, normalizedText);
    const addressCoverage = this.addressCoverage(company.address, normalizedText);
    const domainCoverage = this.domainCoverage(company.company_name, url);
    const hasContactKeywords = this.hasContactKeywords(normalizedText, normalizedTitle);

    // 🖼️ VISUAL SIGNAL: OG:IMAGE
    // If the site has an OpenGraph image that matches the company name, it's a good sign.
    const ogImageMatch = this.checkOgImage(text, company.company_name);

    let confidence = 0.05;
    if (phoneMatch) confidence += 0.65; // BOOSTED: Was 0.55

    if (nameCoverage >= 0.85) confidence += 0.26;
    else if (nameCoverage >= 0.65) confidence += 0.2;
    else if (nameCoverage >= 0.4) confidence += 0.12;

    if (cityMatch) confidence += 0.08;

    if (addressCoverage >= 0.8) confidence += 0.18;
    else if (addressCoverage >= 0.65) confidence += 0.14;
    else if (addressCoverage >= 0.45) confidence += 0.08;

    if (domainCoverage >= 0.8) confidence += 0.20;
    else if (domainCoverage >= 0.5) confidence += 0.10;
    else if (domainCoverage >= 0.3) confidence += 0.05;

    if (hasContactKeywords) confidence += 0.08;

    if (ogImageMatch) confidence += 0.05;

    // Only penalize short text if we don't have strong signals
    // FIX: Do not penalize if we have a very strong Title match (often landing pages are just an image + title)
    const titleOnlyCoverage = this.nameCoverage(company.company_name, normalizedTitle);

    if (normalizedText.length < 160 && nameCoverage < 0.6 && domainCoverage < 0.6 && titleOnlyCoverage < 0.8) {
      confidence -= 0.1;
    }

    // ASSUMPTION: Hard cap at 0.35 should only trigger when BOTH name AND domain fail.
    // Previously this killed valid candidates where domain matched but name tokenization failed.
    if (!phoneMatch && nameCoverage < 0.4 && domainCoverage < 0.5) {
      confidence = Math.min(confidence, 0.35);
    }

    // SYNERGY BONUS: domain + name convergence is a very strong signal for Italian SMBs
    if (domainCoverage >= 0.8 && nameCoverage >= 0.4) confidence += 0.06;

    // MULTI-SIGNAL SYNERGY: strong convergence of independent signals
    const convergenceCount = [
      addressCoverage >= 0.6 ? 1 : 0,
      domainCoverage >= 0.7 ? 1 : 0,
      titleNameMatch ? 1 : 0,
      cityMatch ? 1 : 0,
    ].reduce((a, b) => a + b, 0);
    if (convergenceCount >= 3) {
      confidence += 0.10;
    }

    if (phoneMatch && nameCoverage < 0.25 && domainCoverage < 0.25) {
      confidence = Math.min(confidence, 0.68);
    }

    const reasonParts: string[] = [];
    if (phoneMatch) reasonParts.push('phone match');
    if (nameCoverage >= 0.65) reasonParts.push('strong name match');
    else if (nameCoverage >= 0.4) reasonParts.push('partial name match');
    if (cityMatch) reasonParts.push('city match');
    if (addressCoverage >= 0.45) reasonParts.push('address match');
    if (domainCoverage >= 0.5) reasonParts.push('domain match');
    if (ogImageMatch) reasonParts.push('og:image match');
    if (reasonParts.length === 0) reasonParts.push('weak evidence');

    return {
      confidence: clamp(confidence, 0, 0.99),
      reason: reasonParts.join(', '),
      matchedPhone: matchedPhone || undefined,
      signals: {
        vatMatch: false,
        phoneMatch,
        nameCoverage,
        cityMatch,
        addressCoverage,
        domainCoverage,
        hasContactKeywords,
        ogImageMatch,
      },
    };
  }

  private static checkOgImage(html: string, companyName: string): boolean {
    const ogImageRegex = /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i;
    const match = html.match(ogImageRegex);
    if (!match) return false;
    const url = match[1].toLowerCase();
    const simplifiedName = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
    return url.includes(simplifiedName);
  }

  public static normalizePhone(phone?: string): string {
    if (!phone) return '';
    let digits = phone.replace(/\D/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    return digits;
  }

  public static tokenizeCompanyName(companyName: string): string[] {
    const tokens = tokenize(companyName);
    // ASSUMPTION: Allow 2-char tokens to support brand abbreviations (e.g., "AB" in "AB Meccanica")
    return tokens.filter((token) => token.length >= 2 && !LEGAL_SUFFIXES.has(token));
  }

  // ASSUMPTION: Made public so UnifiedDiscoveryService can use it for title-based matching boost
  public static nameCoverage(companyName: string, normalizedText: string): number {
    const tokens = this.tokenizeCompanyName(companyName);
    if (tokens.length === 0) return 0;

    let matched = 0;
    for (const token of tokens) {
      // Primary: word-boundary match (highest precision). Also handle exact match (text === token)
      if (normalizedText === token || normalizedText.includes(` ${token} `) || normalizedText.startsWith(`${token} `) || normalizedText.endsWith(` ${token}`)) {
        matched++;
        // Secondary: substring match for tokens >= 4 chars (catches compound words like "rossiimpianti")
      } else if (token.length >= 4 && normalizedText.includes(token)) {
        matched++;
      }
    }

    return matched / tokens.length;
  }

  private static cityMatch(city: string | undefined, normalizedText: string): boolean {
    if (!city) return false;
    const cityTokens = tokenize(city).filter((token) => token.length >= 3);
    if (cityTokens.length === 0) return false;
    return cityTokens.every(
      (token) => normalizedText.includes(` ${token} `) || normalizedText.startsWith(`${token} `) || normalizedText.endsWith(` ${token}`)
    );
  }

  private static addressCoverage(address: string | undefined, normalizedText: string): number {
    if (!address) return 0;
    const tokens = tokenize(address).filter((token) => {
      if (/^\d+$/.test(token)) return token.length >= 2;
      return token.length >= 3 && !ADDRESS_NOISE.has(token);
    });
    if (tokens.length === 0) return 0;

    let matched = 0;
    for (const token of tokens.slice(0, 6)) {
      if (normalizedText.includes(` ${token} `) || normalizedText.startsWith(`${token} `) || normalizedText.endsWith(` ${token}`)) {
        matched++;
      }
    }

    return matched / Math.min(tokens.length, 6);
  }

  public static domainCoverage(companyName: string, url: string): number {
    let hostname = '';
    try {
      const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;
      hostname = new URL(normalizedUrl).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return 0;
    }

    const compactHost = hostname.replace(/[^a-z0-9]/g, '');
    const tokens = this.tokenizeCompanyName(companyName);
    if (tokens.length === 0) return 0;

    const compactName = tokens.join('');
    // ASSUMPTION: Lowered from 5 to 3 to support short brand names (e.g., "ABC" -> abcmeccanica.it)
    if (compactName.length >= 3 && compactHost.includes(compactName)) {
      return 1;
    }

    let matched = 0;
    for (const token of tokens) {
      if (compactHost.includes(token)) matched++;
    }
    return matched / tokens.length;
  }

  private static hasContactKeywords(text: string, title: string): boolean {
    const bucket = `${title} ${text}`;
    const signals = [
      'contatti', 'contattaci', 'contattami',
      'chi siamo', 'dove siamo', 'about us',
      'privacy', 'cookie policy', 'note legali',
      'impressum', 'mappa del sito', 'sitemap',
    ];
    return signals.some(s => bucket.includes(s));
  }

  private static isValidItalianVat(digits: string): boolean {
    if (digits.length !== 11) return false;
    // First 2 digits = province code (001-100) or special codes (120, 121, 888, 999)
    const province = parseInt(digits.substring(0, 3), 10);
    return (province >= 1 && province <= 100) || [120, 121, 888, 999].includes(province);
  }

  private static extractVatNumbers(text: string): string[] {
    const results = new Set<string>();

    // Pattern 1: Standalone 11-digit numbers (validate as Italian VAT)
    const standalone = text.match(/\b\d{11}\b/g) || [];
    standalone.filter(m => this.isValidItalianVat(m)).forEach(m => results.add(m));

    // Pattern 2: P.IVA / Partita IVA followed by IT prefix + 11 digits
    const labeled = text.match(/(?:P\.?\s*I\.?\s*V\.?\s*A\.?|Partita\s*Iva|C\.?\s*F\.?\s*(?:\/|\s*e\s*)\s*P\.?\s*I\.?\s*V\.?\s*A\.?)[:\s]*(?:IT)?[\s]?(\d{11})/gi) || [];
    for (const match of labeled) {
      const digits = match.match(/(\d{11})/);
      if (digits) results.add(digits[1]);
    }

    // Pattern 3: IT prefix followed by 11 digits (common in structured data)
    const itPrefixed = text.match(/\bIT\s?(\d{11})\b/g) || [];
    for (const match of itPrefixed) {
      const digits = match.match(/(\d{11})/);
      if (digits) results.add(digits[1]);
    }

    return [...results];
  }

  private static extractPhones(text: string): string[] {
    const matches = text.match(/(?:\+?\d[\d\s()./-]{5,}\d)/g) || [];
    const phones = matches
      .map((raw) => this.normalizePhone(raw))
      .filter((digits) => {
        // Italian phone numbers: landlines start with 0 (9+ digits), mobiles start with 3 (10 digits)
        // With country code 39: 11-13 digits
        if (digits.length < 9 || digits.length > 15) return false;
        // Filter out common false positives (years, prices, codes)
        if (/^(19|20)\d{2}/.test(digits) && digits.length <= 10) return false; // Year-like
        if (/^0{3,}/.test(digits)) return false; // Leading zeros (e.g., 0000...)
        // Italian numbers should start with 0, 3, or 39
        if (digits.startsWith('39')) return true; // International format
        if (digits.startsWith('0') || digits.startsWith('3')) return true; // Domestic
        return false;
      });
    return [...new Set(phones)];
  }

  private static findMatchingPhone(targetPhone: string, candidates: string[]): string | null {
    if (!targetPhone || candidates.length === 0) return null;

    const variants = new Set<string>();
    variants.add(targetPhone);

    if (targetPhone.startsWith('39') && targetPhone.length > 10) {
      const withoutPrefix = targetPhone.slice(2);
      variants.add(withoutPrefix);
      if (!withoutPrefix.startsWith('0')) {
        variants.add(`0${withoutPrefix}`);
      }
    }

    if (targetPhone.startsWith('0') && targetPhone.length >= 9) {
      variants.add(`39${targetPhone}`);
    }

    for (const candidate of candidates) {
      if (variants.has(candidate)) return candidate;

      for (const variant of variants) {
        if (variant.length >= 8 && candidate.endsWith(variant)) return candidate;
        if (candidate.length >= 8 && variant.endsWith(candidate)) return candidate;
      }
    }

    return null;
  }
}
