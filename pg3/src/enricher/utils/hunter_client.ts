import axios, { AxiosError } from 'axios';
import { Logger } from '../../shared-runtime/logging/Logger';

const BASE_URL = 'https://api.hunter.io/v2';

export interface HunterEmail {
  value: string;
  type: 'generic' | 'personal';
  confidence: number; // 0–100 scale
  first_name?: string;
  last_name?: string;
  position?: string;
  seniority?: string;
  department?: string;
  linkedin?: string;
  verification?: {
    date?: string;
    status?: 'valid' | 'accept_all' | 'disposable' | 'invalid' | 'webmail' | null;
  };
}

export interface HunterDomainSearchData {
  domain: string;
  organization?: string;
  emails: HunterEmail[];
}

export class HunterClient {
  constructor(private readonly apiKey: string) {}

  /**
   * Free endpoint: returns how many emails Hunter has for a domain.
   * Use this before domainSearch to avoid spending credits on empty domains.
   */
  async emailCount(domain: string): Promise<number> {
    try {
      const res = await axios.get(`${BASE_URL}/email-count`, {
        params: { domain, api_key: this.apiKey },
        timeout: 10000,
      });
      return (res.data?.data?.total as number) ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Costs 1 credit for 1–10 emails returned. Returns null on API error.
   */
  async domainSearch(domain: string, limit = 10): Promise<HunterDomainSearchData | null> {
    try {
      const res = await axios.get(`${BASE_URL}/domain-search`, {
        params: { domain, limit, api_key: this.apiKey },
        timeout: 15000,
      });
      return (res.data?.data as HunterDomainSearchData) ?? null;
    } catch (err) {
      const status = (err as AxiosError)?.response?.status;
      if (status === 402) {
        Logger.warn('[HunterClient] No credits remaining for domain search');
      } else if (status === 429) {
        Logger.warn('[HunterClient] Rate limited by Hunter API');
      } else {
        Logger.warn(`[HunterClient] domainSearch error for ${domain}: ${(err as Error).message}`);
      }
      return null;
    }
  }

  /**
   * Extracts the apex domain from a full URL.
   * https://www.example.com/page → example.com
   */
  static extractDomain(url: string): string | null {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }

  /**
   * Selects the most outreach-suitable email from a domain search result:
   * prefers personal addresses (decision-maker direct) over generic ones,
   * then ranks by confidence score descending.
   */
  static pickBestEmail(emails: HunterEmail[]): HunterEmail | null {
    if (!emails.length) return null;
    return [...emails].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'personal' ? -1 : 1;
      return (b.confidence ?? 0) - (a.confidence ?? 0);
    })[0] ?? null;
  }

  /** Normalizes Hunter's 0–100 confidence to 0–1. */
  static normalizeConfidence(hunterConfidence: number): number {
    return Math.min(1, Math.max(0, hunterConfidence / 100));
  }
}
