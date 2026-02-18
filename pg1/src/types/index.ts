export type InputRow = {
    company_name: string;
    vat_id?: string; // Partita IVA
    phone?: string;
    address?: string;
    city?: string;
    province?: string;
    postal_code?: string;
    industry?: string;
    source_url?: string;
    initial_website?: string; // From CSV input if available
    country?: string;
};

export type NormalizedEntity = {
    company_name: string;
    vat_id?: string;
    city: string;
    province: string;
    address_tokens: string[];
    phones: string[]; // Normalized formatted phones
    raw_phones: string[]; // Digits only
    fingerprint: string;
    source_row: InputRow;
};

export enum SiteType {
    CORPORATE = 'CORPORATE',
    DIRECTORY = 'DIRECTORY',
    SOCIAL = 'SOCIAL',
    MARKETPLACE = 'MARKETPLACE',
    PARKED = 'PARKED',
    UNKNOWN = 'UNKNOWN',
}

export type Candidate = {
    root_domain: string;
    source_url: string; // The specific URL found (can be subpage)
    rank: number;
    provider: string;
    snippet?: string;
    title?: string;
    aliases?: string[];
    sources?: string[];
};

export type Evidence = {
    phones_found: string[];
    addresses_found: string[];
    vat_ids_found: string[];
    emails_found: string[];
    social_links_found: string[];
    meta_title?: string;
    meta_description?: string;
    h1_headers: string[];
    site_type: SiteType;
    dns_ok: boolean;
    http_ok: boolean;
    is_https: boolean;
    has_privacy_policy: boolean;
    has_contact_page: boolean;
    parked_indicators_count: number;
    structured_data?: any;
    // Match scores (0-1) for scoring
    address_match_score: number;
    name_match_score: number;
};

export type ScoreBreakdown = {
    base_score: number;
    strong_signals_score: number;
    corroborating_signals_score: number;
    penalties_score: number;
    final_score: number;
    details: string[];
};

export enum DecisionStatus {
    OK = 'OK',
    OK_LIKELY = 'OK_LIKELY',
    NO_DOMAIN_FOUND = 'NO_DOMAIN_FOUND',
    AMBIGUOUS = 'AMBIGUOUS',
    REJECTED_DIRECTORY = 'REJECTED_DIRECTORY',
    ERROR = 'ERROR',
    ERROR_FETCH = 'ERROR_FETCH',
    ERROR_DNS = 'ERROR_DNS',
    ERROR_TIMEOUT = 'ERROR_TIMEOUT',
    ERROR_BLOCKED = 'ERROR_BLOCKED',
}

export type OutputResult = {
    domain_official: string | null;
    site_url_official: string | null;
    status: DecisionStatus;
    reason_code: string;
    score: number;
    confidence: number;
    decision_reason: string;
    evidence_json: string;
    candidates_json: string;
    run_id: string;
    timestamp_utc: string;
    error_message?: string;
};

export type SearchResult = {
    url: string;
    title: string;
    snippet: string;
};

export interface SearchProvider {
    name: string; // Add name property
    search(query: string, limit: number): Promise<SearchResult[]>;
}
