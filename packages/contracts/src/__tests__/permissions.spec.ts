import { describe, expect, it } from 'vitest';
import {
  membershipPageQuery,
  membershipPermissionsQuery,
  permissionOverrideInput,
  revokePermissionOverrideInput,
} from '../identity/permissions.js';
import { buildOpenApiDocument } from '../openapi.js';

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

describe('revoke and history contracts', () => {
  it('requires a trimmed reason and refuses all client-controlled fields', () => {
    expect(revokePermissionOverrideInput.parse({ reason: ' reason ' })).toEqual({
      reason: 'reason',
    });
    for (const input of [
      {},
      { reason: '' },
      { reason: ' ' },
      { reason: 'x'.repeat(501) },
      { reason: 'valid', expires_at: null },
    ])
      expect(revokePermissionOverrideInput.safeParse(input).success).toBe(false);
  });
  it('validates the independent history UUID cursor', () => {
    expect(membershipPermissionsQuery.parse({ history_cursor: body.scope_id }).history_cursor).toBe(
      body.scope_id,
    );
    expect(membershipPermissionsQuery.safeParse({ history_cursor: 'bad' }).success).toBe(false);
  });
  it('publishes create 201 and revoke 200 with the required reason contract', () => {
    const document = buildOpenApiDocument();
    const paths = document.paths as Record<
      string,
      { post?: { responses?: unknown; requestBody?: unknown } }
    >;
    expect(
      paths['/v1/permissions/memberships/{membershipId}/overrides']?.post?.responses,
    ).toHaveProperty('201');
    const revoke =
      paths['/v1/permissions/memberships/{membershipId}/overrides/{overrideId}/revoke']?.post;
    expect(revoke?.responses).toHaveProperty('200');
    expect(revoke?.requestBody).toMatchObject({ required: true });
  });
});
