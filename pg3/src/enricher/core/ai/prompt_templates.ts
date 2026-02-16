import { CompanyInput } from '../../types';

/**
 * 📝 PROMPT TEMPLATES LIBRARY
 *
 * Centralized, version-controlled LLM prompts following 2026 best practices:
 * - Clear role/task separation
 * - Triple-backtick delimiters for data sections
 * - ALLCAPS section headers for visual parsing
 * - Explicit JSON schemas with type hints
 * - Few-shot examples for complex tasks
 * - Chain-of-thought prompting for reasoning
 *
 * **Law 506: Prompt Versioning** — All prompts are code.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 1: COMPANY VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

export interface ValidationPromptVars {
    companyName: string;
    city: string;
    address?: string;
    vat?: string;
    phone?: string;
    cleanHtml: string;
}

export const VALIDATE_COMPANY_PROMPT = {
    system: `You are an expert business validation AI. Your task is to determine if a webpage belongs to a specific Italian company by analyzing the content and comparing it to known company details.`,

    template: (vars: ValidationPromptVars) => `
╔══════════════════════════════════════════════════════════════╗
║ VALIDATION TASK: Does this webpage belong to the target company? ║
╚══════════════════════════════════════════════════════════════╝

TARGET COMPANY:
\`\`\`
Name: "${vars.companyName}"
City: "${vars.city}"
Address: "${vars.address || 'N/A'}"
VAT (P.IVA): "${vars.vat || 'N/A'}"
Phone: "${vars.phone || 'N/A'}"
\`\`\`

WEBPAGE CONTENT:
\`\`\`
${vars.cleanHtml}
\`\`\`

EXAMPLES (FEW-SHOT LEARNING):

Example 1: ✅ STRONG MATCH
Input: Target="Acme Srl" (Milano), Content="Benvenuti in Acme Srl, leader a Milano. P.IVA 12345678901."
Output:
{
  "thought": "The webpage explicitly mentions 'Acme Srl' and the location 'Milano'. The VAT number is present. This is clearly the official site.",
  "isValid": true,
  "confidence": 0.95,
  "reasoning": "Exact name and city match. VAT number found.",
  "entity_type": "official_site",
  "next_action": "accept"
}

Example 2: ❌ REJECT (Directory)
Input: Target="Beta Spa" (Roma), Content="PagineGialle: Beta Spa a Roma. Telefono..."
Output:
{
  "thought": "The content is from PagineGialle, which is a business directory, not the official website of 'Beta Spa'. matching name but wrong entity type.",
  "isValid": false,
  "confidence": 0.1,
  "reasoning": "Detected directory/aggregator site (PagineGialle).",
  "entity_type": "directory",
  "next_action": "reject"
}

Example 3: ⚠️ UNCERTAIN (Name Match, Wrong City)
Input: Target="Gamma Snc" (Torino), Content="Gamma Snc - Sede di Napoli. Produzione di..."
Output:
{
  "thought": "The company name 'Gamma Snc' matches, but the city is 'Napoli' while the target is 'Torino'. This could be a different branch or a different company with the same name.",
  "isValid": false,
  "confidence": 0.4,
  "reasoning": "Name matches but city implies different location (Napoli vs Torino).",
  "entity_type": "uncertain",
  "next_action": "reject"
}

DECISION CRITERIA:
1. ✅ STRONG MATCH (confidence ≥ 0.9):
   - Exact VAT number match on a non-directory page
   - Exact phone number match + company name match

2. ✅ GOOD MATCH (confidence 0.6-0.8):
   - Company name + city match on official business site
   - Address match + company name on dedicated page

3. ❌ REJECT (confidence < 0.5):
   - No company name found
   - Directory/aggregator site (e.g., PagineGialle, Infobel)
   - Social media profile page only
   - Generic "About Us" template with different company

4. ⚠️ UNCERTAIN (confidence 0.5-0.6):
   - Name match but no location confirmation
   - Similar company name (possible typo/variation)

ENTITY CLASSIFICATION:
- "official_site" → Company's own website
- "directory" → Business directory (PagineGialle, TripAdvisor, etc.)
- "social" → Social media profile (Facebook, LinkedIn, etc.)
- "uncertain" → Cannot determine with confidence

NEXT ACTION:
- "accept" → High confidence (≥ 0.8), official site, use this data
- "crawl_contact" → Medium confidence (0.6-0.7), extract contacts for verification
- "reject" → Low confidence or directory/social page
- "manual_review" → Uncertain cases

OUTPUT SCHEMA:
\`\`\`json
{
  "thought": "Step-by-step reasoning for the decision (REQUIRED, detailed)",
  "isValid": boolean,
  "confidence": number (0.0-1.0),
  "reasoning": "Final summary of the decision",
  "entity_type": "official_site" | "directory" | "social" | "uncertain",
  "next_action": "accept" | "crawl_contact" | "reject" | "manual_review"
}
\`\`\`
    `.trim(),

    schema: {
        type: 'object' as const,
        properties: {
            thought: { type: 'string' as const },
            isValid: { type: 'boolean' as const },
            confidence: { type: 'number' as const },
            reasoning: { type: 'string' as const },
            entity_type: {
                type: 'string' as const,
                enum: ['official_site', 'directory', 'social', 'uncertain']
            },
            next_action: {
                type: 'string' as const,
                enum: ['accept', 'crawl_contact', 'reject', 'manual_review']
            },
        },
        required: ['thought', 'isValid', 'confidence', 'reasoning', 'entity_type', 'next_action'] as const,
        additionalProperties: false as const,
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 2: CONTACT EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

export interface ContactExtractionVars {
    companyName: string;
    cleanHtml: string;
}

export const EXTRACT_CONTACTS_PROMPT = {
    system: `You are an expert data extraction AI specialized in Italian business contact information. Extract VAT numbers, PEC emails, phone numbers, and decision makers from webpage content.`,

    template: (vars: ContactExtractionVars) => `
╔══════════════════════════════════════════════════════════════╗
║ EXTRACTION TASK: Find contact info for "${vars.companyName}" ║
╚══════════════════════════════════════════════════════════════╝

WEBPAGE CONTENT:
\`\`\`
${vars.cleanHtml}
\`\`\`

EXTRACTION RULES:

1️⃣ VAT NUMBER (Partita IVA):
   - Exactly 11 digits
   - Often labeled as "P.IVA", "Partita IVA", "VAT", "P. IVA"
   - May include "IT" prefix (remove it)
   - Example: 12345678901

2️⃣ PEC EMAIL:
   - Italian certified email (posta elettronica certificata)
   - Ends with @pec.it, @legalmail.it, @arubapec.it, etc.
   - Example: info@azienda.pec.it

3️⃣ CEO/OWNER NAME:
   - Look for "Titolare", "CEO", "Amministratore Delegato", "Presidente"
   - Full name (First + Last)
   - Example: "Mario Rossi"

4️⃣ PHONE NUMBER:
   - Italian format: +39 followed by area code
   - Mobile numbers start with +39 3xx
   - Landline numbers vary by region
   - Example: +39 030 123456 or +39 333 1234567

5️⃣ EMAIL (Generic):
   - Standard email addresses (not PEC)
   - Prefer personal/CEO emails over info@/contact@
   - Example: mario.rossi@azienda.it

OUTPUT SCHEMA:
\`\`\`json
{
  "vat": "12345678901" or null,
  "pec": "email@pec.it" or null,
  "ceo_name": "Mario Rossi" or null,
  "phone": "+39 XXX XXXXXXX" or null,
  "email": "email@domain.it" or null,
  "confidence": 0.0-1.0
}
\`\`\`

If a field is not found, return null. Confidence reflects how certain you are about the extracted data.
    `.trim(),

    schema: {
        type: 'object' as const,
        properties: {
            vat: { type: ['string', 'null'] as any },
            pec: { type: ['string', 'null'] as any },
            ceo_name: { type: ['string', 'null'] as any },
            phone: { type: ['string', 'null'] as any },
            email: { type: ['string', 'null'] as any },
            confidence: { type: 'number' as const },
        },
        required: ['confidence'] as const,
        additionalProperties: false as const,
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 3: BUSINESS CLASSIFICATION (B2B / B2C)
// ═══════════════════════════════════════════════════════════════════════════════

export interface ClassificationVars {
    companyName: string;
    cleanHtml: string;
}

export const CLASSIFY_BUSINESS_PROMPT = {
    system: `You are a Tier-1 Business Intelligence Analyst AI. Your specialty is DEDUCTIVE REASONING. You do not just read text; you interpret context, technical terminology, and implicit signals to construct a profile of the company.`,

    template: (vars: ClassificationVars) => `
╔══════════════════════════════════════════════════════════════╗
║ INTELLIGENCE TASK: Profile "${vars.companyName}"             ║
╚══════════════════════════════════════════════════════════════╝

WEBPAGE CONTENT:
\`\`\`
${vars.cleanHtml}
\`\`\`

EXAMPLES (FEW-SHOT LEARNING):

Example 1: B2B Industrial
Input: Content="Produzione di minuterie metalliche tornite di precisione. Certificazione ISO 9001. Parco macchine CNC..."
Output:
{
  "thought": "The text mentions 'minuterie metalliche' (small metal parts), 'tornite' (turned), and 'CNC'. 'ISO 9001' indicates a structured business. The customers are likely other manufacturers.",
  "type": "B2B",
  "primary_sector": "Manufacturing",
  "specific_niche": "Precision Turning / Machining",
  "deduced_tags": ["Subcontracting", "Metalworking", "CNC Machining"],
  "confidence": 0.95,
  "reasoning": "Technical vocabulary (CNC, ISO 9001) confirms B2B manufacturing role."
}

Example 2: B2C Service
Input: Content="Prenota il tuo tavolo online. Scopri il nostro menu degustazione. Vini pregiati e atmosfera romantica."
Output:
{
  "thought": "Terms like 'Prenota' (Book), 'menu', 'vini' (wines) clearly indicate a restaurant. Targeted at end consumers.",
  "type": "B2C",
  "primary_sector": "Hospitality",
  "specific_niche": "Fine Dining Restaurant",
  "deduced_tags": ["Restaurant", "Food & Beverage", "Reservations"],
  "confidence": 0.98,
  "reasoning": "Standard restaurant vocabulary targeting consumers."
}

🕵️‍♂️ DEDUCTION GUIDELINES:

1. **LOOK FOR IMPLICIT SIGNALS**:
   - "CNC", "Turning", "Milling" → IMPLIES **Mechanical Engineering / Manufacturing**
   - "ISO 9001", "Certified" → IMPLIES **Established B2B Industrial**
   - "Cart", "Checkout", "Free Shipping" → IMPLIES **B2C / E-commerce**
   - "Consulting", "Audit", "Strategy" → IMPLIES **Professional Services**

2. **ANALYZE THE "VIBE"**:
   - Use of jargon/technical specs? → B2B Specialist
   - Emotional/aspirational language? → B2C Consumer Brand

3. **CLASSIFY WITH NUANCE**:
   - Don't just pick a broad sector. Deduce the *specific* niche.

OUTPUT SCHEMA:
\`\`\`json
{
  "thought": "Step-by-step deduction process (REQUIRED)",
  "type": "B2B" | "B2C" | "BOTH" | "UNKNOWN",
  "primary_sector": "Manufacturing" | "Technology" | "Services" | "Retail" | "Healthcare" | "Real Estate" | "Other",
  "specific_niche": "e.g. Precision Machining, SaaS CRM, Luxury Fashion",
  "deduced_tags": ["tag1", "tag2", "tag3"],
  "confidence": 0.0-1.0,
  "reasoning": "Explain your deduction chain."
}
\`\`\`
    `.trim(),

    schema: {
        type: 'object' as const,
        properties: {
            thought: { type: 'string' as const },
            type: { type: 'string' as const, enum: ['B2B', 'B2C', 'BOTH', 'UNKNOWN'] },
            primary_sector: { type: 'string' as const },
            specific_niche: { type: 'string' as const },
            deduced_tags: { type: 'array' as const, items: { type: 'string' as const } },
            confidence: { type: 'number' as const },
            reasoning: { type: 'string' as const },
        },
        required: ['thought', 'type', 'primary_sector', 'specific_niche', 'confidence', 'reasoning'] as const,
        additionalProperties: false as const,
    }
};



// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 4: SERP URL SELECTION
// ═══════════════════════════════════════════════════════════════════════════════

export interface SerpSelectionVars {
    companyName: string;
    city: string;
    urls: Array<{ url: string; title: string; snippet: string }>;
}

export const SELECT_BEST_URL_PROMPT = {
    system: `You are an expert web analyst. Given search results for an Italian company, identify the URL most likely to be their official website (not directories, social media, or reviews).`,

    template: (vars: SerpSelectionVars) => `
╔══════════════════════════════════════════════════════════════╗
║ URL SELECTION TASK: Find official site for "${vars.companyName}" ║
╚══════════════════════════════════════════════════════════════╝

TARGET COMPANY:
- Name: "${vars.companyName}"
- City: "${vars.city}"

SEARCH RESULTS:
${vars.urls.map((u, i) => `
${i + 1}. URL: ${u.url}
   Title: ${u.title}
   Snippet: ${u.snippet}
`).join('\n')}

EXAMPLES (FEW-SHOT LEARNING):

Example 1: ✅ FOUND OFFICIAL SITE
Input: Target="Delta Srl" (Milano), Results=[{url: "https://www.deltasrl.it", title: "Delta Srl - Servizi online", snippet: "Benvenuti in Delta Srl a Milano..."}]
Output:
{
  "thought": "The first result 'deltasrl.it' matches the company name exactly and the snippet mentions 'Milano'. This is a high-confidence official site.",
  "bestUrl": "https://www.deltasrl.it",
  "confidence": 0.9,
  "reasoning": "Exact domain match and location confirmation in snippet."
}

Example 2: ❌ NO OFFICIAL SITE (Directories Only)
Input: Target="Echo Sas" (Roma), Results=[{url: "https://www.paginegialle.it/echosas", title: "Echo Sas - Roma"}, {url: "https://www.facebook.com/echo", title: "Echo - Home"}]
Output:
{
  "thought": "The results contain only a directory (PagineGialle) and a social media page (Facebook). No dedicated official website detected.",
  "bestUrl": null,
  "confidence": 0.1,
  "reasoning": "Only directory and social media results found."
}

Example 3: ⚠️ AMBIGUOUS (Generic Name)
Input: Target="Ristorante Roma" (Firenze), Results=[{url: "https://www.ristoranteroma.com", title: "Ristorante Roma - Cucina Romana"}, {url: "https://www.tripadvisor.it/...", title: "Ristorante Roma Firenze - Recensioni"}]
Output:
{
  "thought": "Result 1 is 'ristoranteroma.com' but the snippet doesn't explicitly mention 'Firenze', giving it a medium probability. Result 2 confirms a 'Ristorante Roma' exists in Firenze on TripAdvisor. It is likely Result 1 is the site, but not 100% certain without city in snippet.",
  "bestUrl": "https://www.ristoranteroma.com",
  "confidence": 0.6,
  "reasoning": "Domain matches, but lack of explicit city in snippet reduces confidence."
}

DECISION RULES:

✅ OFFICIAL SITE INDICATORS (confidence ≥ 0.8):
- Domain matches company name (e.g., acmesrl.it for "Acme SRL")
- Title contains exact company name
- Snippet describes company services/products
- .com/.it/.eu domain (business domain)

❌ REJECT (confidence < 0.3):
- Directories: paginegialle.it, infobel.it, kompass.com
- Reviews: tripadvisor, trustpilot, yelp
- Social: facebook.com, linkedin.com, instagram.com
- E-commerce platforms: amazon, ebay

⚠️ UNCERTAIN (confidence 0.3-0.7):
- Generic business portals
- Industry-specific directories
- News articles about the company

OUTPUT SCHEMA:
\`\`\`json
{
  "thought": "Step-by-step analysis of the search results (REQUIRED)",
  "bestUrl": "https://example.com" or null,
  "confidence": 0.0-1.0,
  "reasoning": "Final justification for the selection"
}
\`\`\`
    `.trim(),

    schema: {
        type: 'object' as const,
        properties: {
            thought: { type: 'string' as const },
            bestUrl: { type: ['string', 'null'] as any },
            confidence: { type: 'number' as const },
            reasoning: { type: 'string' as const },
        },
        required: ['thought', 'bestUrl', 'confidence', 'reasoning'] as const,
        additionalProperties: false as const,
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 5: AGENT NAVIGATION (DOM Decision)
// ═══════════════════════════════════════════════════════════════════════════════

export interface AgentNavigationVars {
    goal: string;
    pageTitle: string;
    pageUrl: string;
    domSummary: string;
    actionHistory: string[];
}

export const AGENT_NAVIGATION_PROMPT = {
    system: `You are an autonomous web navigation agent. Analyze the visible page elements and decide the next action to achieve the goal. Be precise and avoid repeating actions.`,

    template: (vars: AgentNavigationVars) => `
╔══════════════════════════════════════════════════════════════╗
║ NAVIGATION TASK: "${vars.goal}"                              ║
╚══════════════════════════════════════════════════════════════╝

CURRENT PAGE:
- Title: "${vars.pageTitle}"
- URL: ${vars.pageUrl}

VISIBLE DOM ELEMENTS (Interactive elements have IDs):
\`\`\`
${vars.domSummary}
\`\`\`

RECENT ACTIONS (Last 5):
${vars.actionHistory.slice(-5).map((a, i) => `${i + 1}. ${a}`).join('\n') || 'None'}

AVAILABLE ACTIONS:
1. CLICK <element_id> — Click a button, link, or interactive element
2. TYPE <element_id> <text> — Type text into an input field
3. SCROLL — Scroll down to reveal more content
4. EXTRACT <key> — Extract visible data (e.g., VAT number, email)
5. DONE — Goal achieved successfully
6. FAIL — Cannot proceed (stuck, error, blocked)

DECISION RULES:
- If you see the data you're looking for (goal achieved) → EXTRACT then DONE
- If you see a promising link (e.g., "Contatti", "Chi Siamo") → CLICK it
- If a cookie banner blocks the page → CLICK the accept/close button
- Do NOT repeat actions from recent history
- If stuck after 3 SCROLL attempts → FAIL

OUTPUT SCHEMA:
\`\`\`json
{
  "thought": "Reasoning for the chosen action",
  "action": "CLICK" | "TYPE" | "SCROLL" | "EXTRACT" | "DONE" | "FAIL",
  "target_id": "element_id" (required for CLICK/TYPE),
  "text_value": "text to type" (required for TYPE),
  "extraction_key": "vat_number" (required for EXTRACT)
}
\`\`\`

Think carefully. Choose the action most likely to achieve the goal.
    `.trim(),

    schema: {
        type: 'object' as const,
        properties: {
            thought: { type: 'string' as const },
            action: { type: 'string' as const, enum: ['CLICK', 'TYPE', 'SCROLL', 'EXTRACT', 'DONE', 'FAIL'] },
            target_id: { type: 'string' as const },
            text_value: { type: 'string' as const },
            extraction_key: { type: 'string' as const },
        },
        required: ['thought', 'action'] as const,
        additionalProperties: false as const,
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 6: SATELLITE IMAGE ANALYSIS (Street View)
// ═══════════════════════════════════════════════════════════════════════════════

export interface SatelliteAnalysisVars {
    companyName: string;
    address: string;
}

export const SATELLITE_ANALYSIS_PROMPT = {
    system: `You are a geospatial analyst AI. Analyze Google Street View images to determine if a location matches a business. Look for signage, building type, and commercial indicators.`,

    template: (vars: SatelliteAnalysisVars) => `
╔══════════════════════════════════════════════════════════════╗
║ IMAGE ANALYSIS: Street View for "${vars.companyName}"        ║
╚══════════════════════════════════════════════════════════════╝

TARGET:
- Company: "${vars.companyName}"
- Address: "${vars.address}"

ANALYSIS CRITERIA:

🏢 COMMERCIAL BUILDING INDICATORS:
- Visible business signage with company name
- Commercial storefront or office building
- Industrial facilities, warehouses
- Parking lot for customers/employees

🏘️ RESIDENTIAL INDICATORS:
- Residential homes, apartments
- No visible signage
- Residential-only neighborhood

🏗️ INDUSTRIAL INDICATORS:
- Factory buildings, warehouses
- Loading docks, industrial equipment
- Manufacturing facilities

🚫 EMPTY/ABANDONED:
- Vacant lot, construction site
- Abandoned building
- No visible activity

SIGNAGE DETECTION:
- Does the signage match the company name?
- Partial match (e.g., acronym, shortened name)
- No match or no signage visible

OUTPUT SCHEMA:
\`\`\`json
{
  "isCommercial": boolean,
  "type": "commercial" | "residential" | "industrial" | "empty",
  "signage": boolean (true if company name visible),
  "confidence": 0.0-1.0,
  "reason": "What you see in the image"
}
\`\`\`

Analyze the image carefully. Describe what you see.
    `.trim(),

    schema: {
        type: 'object' as const,
        properties: {
            isCommercial: { type: 'boolean' as const },
            type: { type: 'string' as const, enum: ['commercial', 'residential', 'industrial', 'empty'] },
            signage: { type: 'boolean' as const },
            confidence: { type: 'number' as const },
            reason: { type: 'string' as const },
        },
        required: ['isCommercial', 'type', 'signage', 'confidence', 'reason'] as const,
        additionalProperties: false as const,
    }
};
