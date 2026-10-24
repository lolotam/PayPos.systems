import { describe, expect, it } from 'vitest';

import { signOutResult } from '../identity/staff-otp.js';
import { buildOpenApiDocument } from '../openapi.js';

interface OperationResponse {
  readonly content: { readonly 'application/json': { readonly schema: { readonly $ref: string } } };
}

// The published document is read the way openapi.spec.ts reads it: the operation's 200 response and its $ref.
const referenceOf = (document: Record<string, unknown>, path: string): string | undefined => {
  const paths = document['paths'] as Record<
    string,
    { post?: { responses: Record<string, OperationResponse> } }
  >;
  const response = paths[path]?.post?.responses['200'];
  return response?.content['application/json'].schema.$ref;
};

describe('the sign-out result', () => {
  it('accepts the two statuses only', () => {
    expect(signOutResult.parse({ status: 'SIGNED_OUT' })).toEqual({ status: 'SIGNED_OUT' });
    expect(signOutResult.parse({ status: 'NO_SESSION' })).toEqual({ status: 'NO_SESSION' });
    expect(signOutResult.safeParse({ status: 'SIGNED_OUT_AGAIN' }).success).toBe(false);
    expect(signOutResult.safeParse({ status: 'signout' }).success).toBe(false);
    expect(signOutResult.safeParse({}).success).toBe(false);
  });
});

it('publishes the sign-out result on both operations', () => {
  const document = buildOpenApiDocument();
  expect(referenceOf(document, '/v1/devices/me/staff-session/sign-out')).toBe(
    '#/components/schemas/SignOutResult',
  );
  expect(referenceOf(document, '/v1/staff/personal-session/sign-out')).toBe(
    '#/components/schemas/SignOutResult',
  );
});
