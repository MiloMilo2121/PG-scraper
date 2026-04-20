import { NormalizedInput } from '../../../foundation/InputNormalizer';
import { PecHunter } from '../../../foundation/PecHunter';
import { HunterClient } from '../../utils/hunter_client';
import { Logger } from '../../../shared-runtime/logging/Logger';
import { RuntimeStageOutcome } from './stage_types';

export interface ContactStageResult {
  pec: string | null;
  email: string | null;
  outcome: RuntimeStageOutcome;
}

export class ContactEnrichmentStage {
  constructor(
    private readonly pecHunter: PecHunter,
    private readonly hunterClient?: HunterClient,
  ) {}

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

  /**
   * Calls Hunter.io Domain Search as a fallback when the website scan found nothing.
   * Strategy: free emailCount check first → domainSearch (1 credit for up to 10 emails).
   * Returns the best email found, or null.
   */
  private async tryHunter(discoveredUrl: string): Promise<{ email: string; confidence: number; organization?: string } | null> {
    if (!this.hunterClient) return null;

    const domain = HunterClient.extractDomain(discoveredUrl);
    if (!domain) return null;

    // Free check: skip if Hunter has zero emails for this domain
    const count = await this.hunterClient.emailCount(domain);
    if (count === 0) {
      Logger.debug(`[ContactStage] Hunter has no emails for ${domain}`);
      return null;
    }

    const result = await this.hunterClient.domainSearch(domain, 10);
    if (!result || !result.emails.length) return null;

    const picked = HunterClient.pickBestEmails(result.emails, 2);
    if (!picked.values.length) return null;

    const emailStr = picked.values.join(', ');
    Logger.info(
      `[ContactStage] Hunter: ${result.emails.length} email(s) for ${domain} → ${emailStr} (${picked.isPersonal ? 'personal' : 'generic'}, conf: ${picked.confidence})`
    );

    return {
      email: emailStr,
      confidence: HunterClient.normalizeConfidence(picked.confidence),
      organization: result.organization,
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

      if (contacts.pec || contacts.email) {
        return {
          pec: contacts.pec || null,
          email: contacts.email || null,
          outcome: {
            stage: 'contacts',
            status: 'success',
            duration_ms: Date.now() - startedAt,
            detail: 'contact signals found',
            reason_code: 'CONTACTS_FOUND',
            confidence: contacts.pec ? 0.95 : 0.9,
            provider: contacts.source || 'website_contact_scan',
            source_url: discoveredUrl,
            attempted_count: 1,
            evidence_count: [contacts.pec, contacts.email].filter(Boolean).length,
            entity_match_status: 'matched',
          },
        };
      }

      // PecHunter found nothing — try Hunter.io as secondary source
      const hunterResult = await this.tryHunter(discoveredUrl);
      if (hunterResult) {
        return {
          pec: null,
          email: hunterResult.email,
          outcome: {
            stage: 'contacts',
            status: 'success',
            duration_ms: Date.now() - startedAt,
            detail: hunterResult.organization
              ? `Hunter domain search: ${hunterResult.organization}`
              : 'Hunter domain search',
            reason_code: 'CONTACTS_HUNTER_DOMAIN_SEARCH',
            confidence: hunterResult.confidence,
            provider: 'hunter_domain_search',
            source_url: discoveredUrl,
            attempted_count: 2,
            evidence_count: 1,
            entity_match_status: 'matched',
          },
        };
      }

      // Fall back to input email if available
      if (input.email) {
        return this.buildConfirmedContactResult(input, startedAt, 'fallback', discoveredUrl);
      }

      return {
        pec: null,
        email: null,
        outcome: {
          stage: 'contacts',
          status: 'not_found',
          duration_ms: Date.now() - startedAt,
          detail: 'no contact signals found',
          reason_code: 'CONTACTS_NOT_FOUND',
          confidence: 0,
          source_url: discoveredUrl,
          attempted_count: this.hunterClient ? 2 : 1,
          evidence_count: 0,
          entity_match_status: 'unknown',
        },
      };
    } catch (error) {
      // PecHunter errored — still attempt Hunter before giving up
      const hunterResult = await this.tryHunter(discoveredUrl);
      if (hunterResult) {
        return {
          pec: null,
          email: hunterResult.email,
          outcome: {
            stage: 'contacts',
            status: 'success',
            duration_ms: Date.now() - startedAt,
            detail: 'Hunter domain search (website scan failed)',
            reason_code: 'CONTACTS_HUNTER_DOMAIN_SEARCH',
            confidence: hunterResult.confidence,
            provider: 'hunter_domain_search',
            source_url: discoveredUrl,
            attempted_count: 2,
            evidence_count: 1,
            entity_match_status: 'matched',
          },
        };
      }

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
