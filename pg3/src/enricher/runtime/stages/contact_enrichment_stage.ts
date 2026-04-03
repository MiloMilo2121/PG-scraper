import { NormalizedInput } from '../../../foundation/InputNormalizer';
import { PecHunter } from '../../../foundation/PecHunter';
import { RuntimeStageOutcome } from './stage_types';

export interface ContactStageResult {
  pec: string | null;
  email: string | null;
  outcome: RuntimeStageOutcome;
}

export class ContactEnrichmentStage {
  constructor(private readonly pecHunter: PecHunter) {}

  public async run(companyId: string, input: NormalizedInput, discoveredUrl: string | null): Promise<ContactStageResult> {
    const startedAt = Date.now();

    if (!discoveredUrl) {
      return {
        pec: null,
        email: null,
        outcome: {
          stage: 'contacts',
          status: 'skipped',
          duration_ms: Date.now() - startedAt,
          detail: 'website discovery required before contact extraction',
          reason_code: 'CONTACTS_SKIPPED_NO_WEBSITE',
        },
      };
    }

    try {
      const contacts = await this.pecHunter.hunt(companyId, input, discoveredUrl);
      return {
        pec: contacts.pec || null,
        email: contacts.email || null,
        outcome: {
          stage: 'contacts',
          status: contacts.pec || contacts.email ? 'success' : 'not_found',
          duration_ms: Date.now() - startedAt,
          detail: contacts.pec || contacts.email ? 'contact signals found' : 'no contact signals found',
          reason_code: contacts.pec || contacts.email ? 'CONTACTS_FOUND' : 'CONTACTS_NOT_FOUND',
          confidence: contacts.pec ? 0.95 : contacts.email ? 0.9 : 0,
          provider: contacts.pec || contacts.email ? contacts.source || 'website_contact_scan' : undefined,
          source_url: discoveredUrl,
          attempted_count: 1,
          evidence_count: [contacts.pec, contacts.email].filter(Boolean).length,
          entity_match_status: contacts.pec || contacts.email ? 'matched' : 'unknown',
        },
      };
    } catch (error) {
      return {
        pec: null,
        email: null,
        outcome: {
          stage: 'contacts',
          status: 'failed',
          duration_ms: Date.now() - startedAt,
          error: (error as Error).message,
          reason_code: 'CONTACTS_FAILED',
          source_url: discoveredUrl,
          attempted_count: 1,
        },
      };
    }
  }
}
