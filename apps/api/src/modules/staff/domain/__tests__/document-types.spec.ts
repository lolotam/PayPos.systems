import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_TYPE_LIMIT,
  customDocumentTypeCode,
  newDocumentType,
  reviseDocumentType,
  setDocumentTypeActive,
  validateDocumentTypeTerms,
  type DocumentTypeRecord,
} from '../document-types.ts';

const id = '01920000-0000-7000-8000-0000000000ab';
const terms = { name_en: ' Visa ', name_ar: ' تأشيرة ', alert_days: 15, requires_expiry: true };
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return 'NO_ERROR';
};
const stored: DocumentTypeRecord = {
  id,
  code: 'civil_id',
  name_en: 'Civil ID',
  name_ar: null,
  alert_days: 30,
  requires_expiry: true,
  active: true,
  revision: 3,
};

describe('validateDocumentTypeTerms', () => {
  it('trims both names and turns a blank Arabic name into null', () => {
    expect(validateDocumentTypeTerms(terms)).toEqual({
      name_en: 'Visa',
      name_ar: 'تأشيرة',
      alert_days: 15,
      requires_expiry: true,
    });
    expect(validateDocumentTypeTerms({ ...terms, name_ar: '  ' }).name_ar).toBeNull();
    expect(validateDocumentTypeTerms({ ...terms, name_ar: undefined }).name_ar).toBeNull();
  });
  it.each([
    [{ ...terms, name_en: '   ' }],
    [{ ...terms, name_en: 'x'.repeat(256) }],
    [{ ...terms, name_ar: 'x'.repeat(256) }],
    [{ ...terms, alert_days: -1 }],
    [{ ...terms, alert_days: 366 }],
    [{ ...terms, alert_days: 2.5 }],
  ])('refuses %j', (input) => {
    expect(code(() => validateDocumentTypeTerms(input))).toBe('VALIDATION_FAILED');
  });
  it('accepts both alert-day bounds and a 255-character name', () => {
    expect(validateDocumentTypeTerms({ ...terms, alert_days: 0 }).alert_days).toBe(0);
    expect(validateDocumentTypeTerms({ ...terms, alert_days: 365 }).alert_days).toBe(365);
    expect(validateDocumentTypeTerms({ ...terms, name_en: 'x'.repeat(255) }).name_en).toHaveLength(
      255,
    );
  });
});

describe('new types', () => {
  it('derive an immutable code from the injected id and start active at revision 1', () => {
    expect(customDocumentTypeCode(id)).toBe('custom_019200000000700080000000000000ab');
    expect(newDocumentType(id, terms, 4)).toMatchObject({
      id,
      code: 'custom_019200000000700080000000000000ab',
      name_en: 'Visa',
      active: true,
      revision: 1,
    });
    expect(code(() => customDocumentTypeCode('not-a-uuid'))).toBe('VALIDATION_FAILED');
  });
  it('stop at the company limit', () => {
    expect(newDocumentType(id, terms, DOCUMENT_TYPE_LIMIT - 1).revision).toBe(1);
    expect(code(() => newDocumentType(id, terms, DOCUMENT_TYPE_LIMIT))).toBe(
      'DOCUMENT_TYPE_LIMIT_REACHED',
    );
  });
});

describe('revisions', () => {
  it('update terms at the expected revision and keep code and active state', () => {
    expect(reviseDocumentType(stored, { ...terms, requires_expiry: false }, 3)).toEqual({
      ...stored,
      name_en: 'Visa',
      name_ar: 'تأشيرة',
      alert_days: 15,
      requires_expiry: false,
      revision: 4,
    });
  });
  it('deactivate and reactivate without deleting, each a new revision', () => {
    const inactive = setDocumentTypeActive(stored, false, 3);
    expect(inactive).toEqual({ ...stored, active: false, revision: 4 });
    expect(setDocumentTypeActive(inactive, true, 4)).toEqual({ ...stored, revision: 5 });
  });
  it('refuse a stale revision and the integer ceiling', () => {
    expect(code(() => reviseDocumentType(stored, terms, 2))).toBe(
      'DOCUMENT_TYPE_REVISION_CONFLICT',
    );
    expect(code(() => setDocumentTypeActive(stored, false, 4))).toBe(
      'DOCUMENT_TYPE_REVISION_CONFLICT',
    );
    const top = { ...stored, revision: 2147483647 };
    expect(code(() => setDocumentTypeActive(top, false, 2147483647))).toBe('VALIDATION_FAILED');
  });
});
