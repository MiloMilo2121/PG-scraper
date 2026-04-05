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

  private buildConfirmedContactResult(
    input: NormalizedInput,
    startedAt: number,
    mode: 'direct' | 'fallback',
    discoveredUrl?: string | null,
  ): ContactStageResult {
    const confirmedPec = this.isLikelyPec(input.email) ? input.email! : null;
    const confirmedEmail = confirmedPec ? null : input.email!;
    const fromPagineGialle = input.email_source === 'paginegialle';
    const isFallback = mode === 'fallback';

    const reasonCode = fromPagineGialle
      ? (confirmedPec
        ? (isFallback ? 'CONTACTS_FALLBACK_PG_PEC' : 'CONTACTS_CONFIRMED_PG_PEC')
        : (isFallback ? 'CONTACTS_FALLBACK_PG_EMAIL' : 'CONTACTS_CONFIRMED_PG_EMAIL'))
      : (confirmedPec
        ? (isFallback ? 'CONTACTS_FALLBACK_INPUT_PEC' : 'CONTACTS_CONFIRMED_INPUT_PEC')
        : (isFallback ? 'CONTACTS_FALLBACK_INPUT_EMAIL' : 'CONTACTS_CONFIRMED_INPUT_EMAIL'));

    const detail = isFallback
      ? (fromPagineGialle
        ? 'website scan found no contacts; reusing confirmed paginegialle contact'
        : 'website scan found no contacts; reusing confirmed input contact')
      : (fromPagineGialle
        ? 'reused confirmed contact from paginegialle without website scan'
        : 'reused confirmed contact from input without website scan');

    return {
      pec: confirmedPec,
      email: confirmedEmail,
      outcome: {
        stage: 'contacts',
        status: 'success',
        duration_ms: Date.now() - startedAt,
        detail,
        reason_code: reasonCode,
        confidence: confirmedPec ? 0.98 : (fromPagineGialle ? 0.92 : 0.95),
        provider: fromPagineGialle ? 'paginegialle_contact' : 'input_contact',
        source_url: isFallback ? (discoveredUrl || undefined) : undefined,
        attempted_count: isFallback ? 1 : 0,
        evidence_count: 1,
        entity_match_status: 'matched',
      },
    };
  }

  public async run(companyId: string, input: NormalizedInput, discoveredUrl: string | null): Promise<ContactStageResult> {
    const startedAt = Date.now();

    if (!discoveredUrl) {
      if (input.email) {
        return this.buildConfirmedContactResult(input, startedAt, 'direct');
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
      if (!(contacts.pec || contacts.email) && input.email) {
        return this.buildConfirmedContactResult(input, startedAt, 'fallback', discoveredUrl);
      }
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
      if (input.email) {
        return this.buildConfirmedContactResult(input, startedAt, 'fallback', discoveredUrl);
      }

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
