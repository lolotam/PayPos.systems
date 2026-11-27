import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ POST: post }) }));

import { requestPasswordResetCode } from './password-reset-calls';

const tooMany = (headers: Record<string, string>) => ({
  data: undefined,
  response: new Response(null, { status: 429, headers }),
});

beforeEach(() => post.mockReset());

describe('a too-many-requests answer to the code request', () => {
  it.each([
    ['a whole number of seconds', '45', 45],
    ['a padded number', ' 30 ', 30],
  ])('carries %s as the retry delay', async (_name, header, seconds) => {
    post.mockResolvedValue(tooMany({ 'Retry-After': header }));
    expect(await requestPasswordResetCode('owner@example.invalid', 'ar')).toEqual({
      kind: 'error',
      key: 'passwordReset.tooMany',
      retryAfter: seconds,
    });
  });

  it.each([
    ['an HTTP date', 'Wed, 21 Oct 2026 07:28:00 GMT'],
    ['zero', '0'],
    ['a negative number', '-5'],
    ['an empty header', ''],
  ])('ignores %s and keeps the plain message', async (_name, header) => {
    post.mockResolvedValue(tooMany({ 'Retry-After': header }));
    expect(await requestPasswordResetCode('owner@example.invalid', 'ar')).toEqual({
      kind: 'error',
      key: 'passwordReset.tooMany',
    });
  });
});
