import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  decidePackageImportCommit,
  PackageImportCommitError,
  requireOwnedPackageImportPreview,
  type StoredPackageImportCommitPreview,
} from '../package-import-commit.ts';

const NOW = new Date('2026-11-25T10:00:00.000Z');
const preview = (
  patch: Partial<StoredPackageImportCommitPreview> = {},
): StoredPackageImportCommitPreview => ({
  id: '018f0000-0000-7000-8000-000000000001',
  business_id: '018f0000-0000-7000-8000-0000000000b1',
  created_by: '018f0000-0000-7000-8000-0000000000c1',
  status: 'ready',
  expires_at: '2026-11-26T10:00:00.000Z',
  error_count: 0,
  has_commit_rows: true,
  ...patch,
});
const refused = (value: StoredPackageImportCommitPreview) => {
  try {
    decidePackageImportCommit(value, NOW);
  } catch (error) {
    return error instanceof PackageImportCommitError ? error.code : 'OTHER';
  }
  return null;
};

describe('decidePackageImportCommit', () => {
  it('requests a clean ready preview before its expiry', () => {
    expect(decidePackageImportCommit(preview(), NOW)).toBe('REQUEST');
  });

  it.each(['commit_requested', 'committed'] as const)(
    'repeats an already accepted %s preview without a new request, even when expired',
    (status) => {
      expect(
        decidePackageImportCommit(preview({ status, expires_at: '2026-11-01T00:00:00.000Z' }), NOW),
      ).toBe('REPEAT');
    },
  );

  it('refuses at and after the exact expiry instant, but not one millisecond before', () => {
    expect(refused(preview({ expires_at: '2026-11-25T10:00:00.000Z' }))).toBe(
      'IMPORT_PREVIEW_EXPIRED',
    );
    expect(refused(preview({ expires_at: '2026-11-25T09:00:00.000Z' }))).toBe(
      'IMPORT_PREVIEW_EXPIRED',
    );
    expect(refused(preview({ expires_at: '2026-11-25T10:00:00.001Z' }))).toBeNull();
  });

  it('refuses previews that still carry errors', () => {
    expect(refused(preview({ error_count: 1 }))).toBe('IMPORT_PREVIEW_HAS_ERRORS');
  });

  it('refuses pending and failed previews with distinct codes', () => {
    expect(refused(preview({ status: 'pending' }))).toBe('IMPORT_FILE_NOT_READY');
    expect(refused(preview({ status: 'failed' }))).toBe('IMPORT_COMMIT_FAILED');
  });

  it('refuses a ready preview that has no stored source-row partition', () => {
    expect(refused(preview({ has_commit_rows: false }))).toBe('IMPORT_COMMIT_FAILED');
  });
});

describe('requireOwnedPackageImportPreview', () => {
  const owner = { businessId: preview().business_id, userId: preview().created_by };

  it('accepts the creator and business, ignoring identifier case', () => {
    expect(() =>
      requireOwnedPackageImportPreview(preview(), {
        businessId: owner.businessId.toUpperCase(),
        userId: owner.userId.toUpperCase(),
      }),
    ).not.toThrow();
  });

  it.each([
    ['unknown', null, owner],
    [
      'another business',
      preview(),
      { ...owner, businessId: '018f0000-0000-7000-8000-0000000000b2' },
    ],
    ['another creator', preview(), { ...owner, userId: '018f0000-0000-7000-8000-0000000000c2' }],
  ] as const)('uses one unknown refusal for %s', (_name, value, actor) => {
    expect(() => requireOwnedPackageImportPreview(value, actor)).toThrowError(
      expect.objectContaining({ code: 'IMPORT_PREVIEW_NOT_FOUND' }),
    );
  });
});

describe('package import commit domain purity', () => {
  it('never reads the clock or generates ids', () => {
    const source = readFileSync(new URL('../package-import-commit.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/Date\.now|new Date\(\)|randomUUID/);
  });
});
