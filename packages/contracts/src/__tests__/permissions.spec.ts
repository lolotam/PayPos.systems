import { describe, expect, it } from 'vitest';
import { membershipPageQuery, permissionOverrideInput } from '../identity/permissions.js';

const body = {
  permission_code: 'read:memberships:company',
  effect: 'ALLOW',
  scope_type: 'COMPANY',
  scope_id: '01920000-0000-7000-8000-0000000000a0',
  reason: 'synthetic reason',
  expires_at: null,
};
describe('permission override contract', () => {
  it.each(['ALLOW', 'DENY'])('accepts %s and trims the required reason', (effect) => {
    expect(permissionOverrideInput.parse({ ...body, effect, reason: ' reason ' }).reason).toBe(
      'reason',
    );
  });
  it.each([
    { reason: ' ' },
    { reason: 'x'.repeat(501) },
    { effect: 'RESET' },
    { scope_type: 'PLATFORM' },
    { permission_code: 'create:companies:platform' },
    { scope_id: 'wrong' },
    { expires_at: 'tomorrow' },
    { granted_by: body.scope_id },
  ])('rejects malformed or client-controlled fields %j', (change) => {
    expect(permissionOverrideInput.safeParse({ ...body, ...change }).success).toBe(false);
  });
  it('bounds the list and accepts only a UUID cursor', () => {
    expect(membershipPageQuery.parse({}).limit).toBe(20);
    expect(membershipPageQuery.safeParse({ limit: 101 }).success).toBe(false);
    expect(membershipPageQuery.safeParse({ cursor: 'garbage' }).success).toBe(false);
  });
});
