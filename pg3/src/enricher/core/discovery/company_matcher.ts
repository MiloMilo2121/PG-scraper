import { CompanyInput } from '../../types';

export interface MatchSignals {
  vatMatch: boolean;
  phoneMatch: boolean;
  nameCoverage: number;
  cityMatch: boolean;
  addressCoverage: number;
  domainCoverage: number;
  hasContactKeywords: boolean;
  hasOgImage: boolean;
  titleNameMatch: boolean;
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
    // Case-insensitive VAT matching: normalize both sides and handle "IT" prefix + spacing
    const matchedVat = targetVat ? this.findMatchingVat(targetVat, vatCandidates) : undefined;
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
          hasOgImage: false,
          titleNameMatch: false,
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
    const hasOgImage = this.hasOgImage(text);
    const titleNameMatch = this.nameCoverage(company.company_name, normalizedTitle) >= 0.6;

    let confidence = 0.05;
    if (phoneMatch) confidence += 0.65;

    if (nameCoverage >= 0.85) confidence += 0.26;
    else if (nameCoverage >= 0.65) confidence += 0.2;
    else if (nameCoverage >= 0.4) confidence += 0.12;

    if (cityMatch) confidence += 0.08;

    if (addressCoverage >= 0.7) confidence += 0.14;
    else if (addressCoverage >= 0.45) confidence += 0.08;

    if (domainCoverage >= 0.8) confidence += 0.20;
    else if (domainCoverage >= 0.5) confidence += 0.10;
    else if (domainCoverage >= 0.3) confidence += 0.05;

    if (hasContactKeywords) confidence += 0.04;

    // VISUAL MATCHER: If og:image is present AND title matches name, accept with boost.
    // Many Italian SMB sites have minimal text but og:image proves it's a real company page.
    if (hasOgImage && titleNameMatch) {
      confidence += 0.08;
    }

    // Only penalize short text if we don't have strong signals (og:image overrides)
    if (normalizedText.length < 160 && nameCoverage < 0.6 && domainCoverage < 0.6 && !hasOgImage) {
      confidence -= 0.1;
    }

    // Hard cap only when BOTH name AND domain fail
    if (!phoneMatch && nameCoverage < 0.4 && domainCoverage < 0.5) {
      confidence = Math.min(confidence, 0.35);
    }

    // SYNERGY BONUS: domain + name convergence
    if (domainCoverage >= 0.8 && nameCoverage >= 0.4) confidence += 0.06;

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
    if (hasOgImage && titleNameMatch) reasonParts.push('visual match (og:image+title)');
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
        hasOgImage,
        titleNameMatch,
      },
    };
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
      // Primary: word-boundary match (highest precision)
      if (normalizedText.includes(` ${token} `) || normalizedText.startsWith(`${token} `) || normalizedText.endsWith(` ${token}`)) {
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

  private static domainCoverage(companyName: string, url: string): number {
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
    return (
      bucket.includes('contatti') ||
      bucket.includes('chi siamo') ||
      bucket.includes('dove siamo') ||
      bucket.includes('about us') ||
      bucket.includes('privacy')
    );
  }

  private static extractVatNumbers(text: string): string[] {
    const results = new Set<string>();

    // Pattern 1: Standalone 11-digit numbers
    const standalone = text.match(/\b\d{11}\b/g) || [];
    standalone.forEach(m => results.add(m));

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
      .filter((digits) => digits.length >= 7 && digits.length <= 15);
    return [...new Set(phones)];
  }

  /**
   * Case-insensitive VAT matching with format normalization.
   * Handles: "IT 123 456 789 01", "IT12345678901", "12345678901"
   */
  private static findMatchingVat(targetVat: string, candidates: string[]): string | undefined {
    if (!targetVat || targetVat.length < 5) return undefined;
    const cleanTarget = targetVat.replace(/\D/g, '');
    for (const candidate of candidates) {
      const cleanCandidate = candidate.replace(/\D/g, '');
      if (cleanCandidate === cleanTarget) return candidate;
    }
    return undefined;
  }

  /**
   * Detect og:image meta tag presence in raw HTML.
   * Pages with og:image are almost certainly real company pages, not directories.
   */
  private static hasOgImage(rawText: string): boolean {
    const lower = rawText.toLowerCase();
    return lower.includes('og:image') || lower.includes('property="og:image"') || lower.includes("property='og:image'");
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
