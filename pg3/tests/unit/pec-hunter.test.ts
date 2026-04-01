import { describe, expect, it } from 'vitest';
import { PecHunter } from '../../src/foundation/PecHunter';

describe('PecHunter', () => {
  it('prefers the website-domain business email over a privacy mailbox on franchise sites', () => {
    const result = (PecHunter as any).prioritizeEmails(
      ['dpo@tecnocasa.com', 'alcn3@tecnocasa.it'],
      'https://alessandria1.tecnocasa.it/',
    );

    expect(result.email).toBe('alcn3@tecnocasa.it');
  });

  it('filters hard-rejected machine mailboxes from extraction', () => {
    const candidates = (PecHunter as any).extractEmails(`
      <a href="mailto:cpanel_notice@notifiche.serverplan.com">machine</a>
      <a href="mailto:info@agenziaborsaimmobiliare.com">business</a>
    `);

    expect(candidates).toContain('info@agenziaborsaimmobiliare.com');
    expect(candidates).not.toContain('cpanel_notice@notifiche.serverplan.com');
  });
});
