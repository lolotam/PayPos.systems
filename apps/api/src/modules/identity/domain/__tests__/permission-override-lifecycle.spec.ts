import { describe, expect, it } from 'vitest';
import { overrideIsCurrent, overrideLifecycleFailure } from '../permission-override-lifecycle.ts';
const now = new Date('2026-10-03T10:00:00Z');
const row = { effect: 'ALLOW' as const, expires_at: null };

describe('override lifecycle owner decision 2026-10-03', () => {
  it.each([null, '2999-01-01T00:00:00Z'])('current expiry %s', (expires_at) => {
    expect(overrideIsCurrent({ ...row, expires_at }, now)).toBe(true);
  });
  it.each([now.toISOString(), '2020-01-01T00:00:00Z'])('ended expiry %s', (expires_at) => {
    expect(overrideIsCurrent({ ...row, expires_at }, now)).toBe(false);
    expect(overrideLifecycleFailure('REVOKE', [{ ...row, expires_at }], false, now)).toBe(
      'PERMISSION_OVERRIDE_ENDED',
    );
  });
  it('allows create, replacement and revoke of non-owner decisions', () => {
    expect(overrideLifecycleFailure('SAVE', [], false, now)).toBeNull();
    expect(overrideLifecycleFailure('SAVE', [row], false, now)).toBeNull();
    expect(overrideLifecycleFailure('REVOKE', [row], false, now)).toBeNull();
  });
  it.each(['SAVE', 'REVOKE'] as const)('protects owner ALLOW from %s', (operation) => {
    expect(overrideLifecycleFailure(operation, [row], true, now)).toBe(
      'PERMISSION_OWNER_PROTECTED',
    );
    expect(overrideLifecycleFailure(operation, [{ ...row, effect: 'DENY' }], true, now)).toBeNull();
  });
  it('protects an ALLOW among legacy stacked rows', () => {
    expect(overrideLifecycleFailure('SAVE', [{ ...row, effect: 'DENY' }, row], true, now)).toBe(
      'PERMISSION_OWNER_PROTECTED',
    );
  });
});
