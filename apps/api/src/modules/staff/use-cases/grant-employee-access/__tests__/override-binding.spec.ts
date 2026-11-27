import { describe, expect, it } from 'vitest';

import type { StaffAccessOverrideTerms } from '../../../ports/staff-access.port.ts';
import { canonicalOverrideKey } from '../override-binding.ts';

/** Compact override terms for the fingerprint unit tests. */
const terms = (overrides: Partial<StaffAccessOverrideTerms>): StaffAccessOverrideTerms => ({
  permission_code: 'read:attendance:branch',
  effect: 'ALLOW',
  scope_type: 'BRANCH',
  scope_id: '01920000-0000-7000-8000-00000000000a',
  reason: 'covering the front desk',
  expires_at: null,
  ...overrides,
});

describe('canonicalOverrideKey', () => {
  it('gives a different fingerprint to the same overrides in a different order', () => {
    const allow = terms({ permission_code: 'create:customers:branch', effect: 'ALLOW' });
    const deny = terms({ permission_code: 'read:attendance:branch', effect: 'DENY' });
    expect(canonicalOverrideKey([allow, deny])).not.toBe(canonicalOverrideKey([deny, allow]));
  });

  it('gives a different fingerprint to the same permission with a different reason', () => {
    const first = terms({ permission_code: 'read:attendance:branch', reason: 'first reason' });
    const second = terms({ permission_code: 'read:attendance:branch', reason: 'second reason' });
    expect(canonicalOverrideKey([first])).not.toBe(canonicalOverrideKey([second]));
  });

  it('normalises the scope id letter case because a uuid is not case sensitive', () => {
    const lower = terms({ scope_id: '01920000-0000-7000-8000-00000000000a' });
    const upper = terms({ scope_id: '01920000-0000-7000-8000-00000000000A' });
    expect(canonicalOverrideKey([lower])).toBe(canonicalOverrideKey([upper]));
  });

  it('treats a missing list of overrides as an empty one', () => {
    expect(canonicalOverrideKey(undefined)).toBe(canonicalOverrideKey([]));
  });
});
