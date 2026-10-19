import { describe, expect, it } from 'vitest';

import { LogoFileRejected } from '../errors.ts';
import { validateLogoFile, type LogoFileFacts } from '../logo-file.ts';

const BUSINESS = '01920000-0000-7000-8000-000000000001';
const ACTOR = '01920000-0000-7000-8000-000000000002';
const OTHER = '01920000-0000-7000-8000-000000000003';

function facts(patch: Partial<LogoFileFacts> = {}): LogoFileFacts {
  return {
    businessId: BUSINESS,
    branchId: null,
    ownerModule: 'settings',
    ownerEntityId: BUSINESS,
    requiredPermission: 'manage:business-identity:business',
    createdBy: ACTOR,
    contentType: 'image/png',
    status: 'READY',
    purged: false,
    purgeStarted: false,
    ...patch,
  };
}

function codeOf(file: LogoFileFacts): string {
  try {
    validateLogoFile(file, BUSINESS, ACTOR);
    return 'READY';
  } catch (error) {
    if (error instanceof LogoFileRejected) return error.code;
    throw error;
  }
}

describe('validateLogoFile', () => {
  it('accepts a READY png or jpeg owned by this business and this actor', () => {
    expect(() => validateLogoFile(facts(), BUSINESS, ACTOR)).not.toThrow();
    expect(() =>
      validateLogoFile(facts({ contentType: 'image/jpeg' }), BUSINESS, ACTOR),
    ).not.toThrow();
  });

  it('answers FILE_NOT_FOUND for every ownership or identity mismatch', () => {
    expect(codeOf(facts({ purged: true }))).toBe('FILE_NOT_FOUND');
    expect(codeOf(facts({ purgeStarted: true }))).toBe('FILE_NOT_FOUND');
    expect(codeOf(facts({ ownerModule: 'staff' }))).toBe('FILE_NOT_FOUND');
    expect(codeOf(facts({ ownerEntityId: OTHER }))).toBe('FILE_NOT_FOUND');
    expect(codeOf(facts({ businessId: OTHER }))).toBe('FILE_NOT_FOUND');
    expect(codeOf(facts({ branchId: OTHER }))).toBe('FILE_NOT_FOUND');
    expect(codeOf(facts({ createdBy: OTHER }))).toBe('FILE_NOT_FOUND');
    expect(codeOf(facts({ requiredPermission: 'read:files:business' }))).toBe('FILE_NOT_FOUND');
    expect(codeOf(facts({ requiredPermission: 'read:settings:business' }))).toBe('FILE_NOT_FOUND');
    expect(codeOf(facts({ contentType: 'application/pdf' }))).toBe('FILE_NOT_FOUND');
    expect(codeOf(facts({ contentType: 'image/jpg' }))).toBe('FILE_NOT_FOUND');
    expect(
      codeOf(
        facts({
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      ),
    ).toBe('FILE_NOT_FOUND');
  });

  it('checks identity before status, and refuses REJECTED as an unknown file', () => {
    expect(codeOf(facts({ status: 'PENDING', contentType: 'application/pdf' }))).toBe(
      'FILE_NOT_FOUND',
    );
    expect(codeOf(facts({ status: 'READY', purgeStarted: true }))).toBe('FILE_NOT_FOUND');
    expect(codeOf(facts({ status: 'PENDING' }))).toBe('FILE_NOT_READY');
    expect(codeOf(facts({ status: 'VERIFYING' }))).toBe('FILE_NOT_READY');
    expect(codeOf(facts({ status: 'REJECTED' }))).toBe('FILE_NOT_FOUND');
  });
});
