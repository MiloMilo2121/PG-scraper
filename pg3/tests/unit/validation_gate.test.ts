import { describe, expect, it } from 'vitest';
import { ValidationGate, ValidationSeverity, VatValidationStatus } from '../../src/enricher/core/validation_gate';

describe('ValidationGate', () => {
  it('normalizes italian phones, canonicalizes URLs, and reports VAT checksum status', () => {
    const report = ValidationGate.validate({
      company_name: 'Acme srl',
      city: 'padova',
      phone: '333 1234567',
      email: 'INFO@ACME.IT',
      website: 'acme.it/?utm_source=test',
      vat_code: '01114601006',
    });

    expect(report.severity).toBe(ValidationSeverity.PASS);
    expect(report.vatStatus).toBe(VatValidationStatus.CHECKSUM_VALID);
    expect(report.normalizedRecord.phone).toBe('+393331234567');
    expect(report.normalizedRecord.phone_type).toBeTruthy();
    expect(report.normalizedRecord.email).toBe('info@acme.it');
    expect(report.normalizedRecord.website).toBe('https://acme.it');
    expect(report.qualityBreakdown.identityScore).toBeGreaterThan(0);
  });

  it('flags invalid VAT and mismatched email domain', () => {
    const report = ValidationGate.validate({
      company_name: 'Beta snc',
      city: 'Verona',
      email: 'info@otherdomain.it',
      website: 'betasnc.it',
      vat_code: '01114601007',
    });

    expect(report.vatStatus).toBe(VatValidationStatus.INVALID_FORMAT);
    expect(report.issues.some((issue) => issue.includes('VAT invalid'))).toBe(true);
    expect(report.issues.some((issue) => issue.includes('Email domain mismatch'))).toBe(true);
    expect(report.qualityScore).toBeLessThan(90);
  });
});
