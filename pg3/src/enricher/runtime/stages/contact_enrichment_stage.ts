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

  private isLikelyPec(email?: string | null): boolean {
    const normalized = (email || '').toLowerCase();
    if (!normalized.includes('@')) {
      return false;
    }

    const domain = normalized.split('@')[1] || '';
    return domain.includes('pec') || domain.includes('legalmail') || domain.includes('cert');
  }

  public async run(companyId: string, input: NormalizedInput, discoveredUrl: string | null): Promise<ContactStageResult> {
    const startedAt = Date.now();

    if (!discoveredUrl) {
      if (input.email) {
        const confirmedPec = this.isLikelyPec(input.email) ? input.email : null;
        const confirmedEmail = confirmedPec ? null : input.email;
        return {
          pec: confirmedPec,
          email: confirmedEmail,
          outcome: {
            stage: 'contacts',
            status: 'success',
            duration_ms: Date.now() - startedAt,
            detail: 'reused confirmed contact from input without website scan',
            reason_code: confirmedPec ? 'CONTACTS_CONFIRMED_INPUT_PEC' : 'CONTACTS_CONFIRMED_INPUT_EMAIL',
            confidence: confirmedPec ? 0.98 : 0.95,
            provider: 'input_contact',
            attempted_count: 0,
            evidence_count: 1,
            entity_match_status: 'matched',
          },
        };
      }

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
