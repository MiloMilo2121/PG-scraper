
export interface CompanyInput {
    company_name: string;
    address?: string;
    city?: string;
    province?: string;
    zip_code?: string;
    region?: string;
    country?: string;

    // Identifiers
    vat_code?: string; // P.IVA
    piva?: string;     // Alias
    vat?: string;      // Alias
    fiscal_code?: string; // CF
    phone?: string;

    // Metadata
    category?: string;
    email?: string;
    website?: string;

    // Enrichment
    revenue?: string;
    revenue_year?: string;
    employees?: string;
    is_estimated_employees?: boolean;
    pec?: string; // PEC Email
    financial_source?: string; // Source of financial data

    decision_maker_name?: string;
    decision_maker_role?: string;
    decision_maker_email?: string;
    decision_maker_linkedin?: string;

    // Legacy mapping (optional)
    dm1_name?: string;
    dm1_role?: string;
    dm1_email?: string;

    // Processing
    source_file?: string;
    [key: string]: any;
}
