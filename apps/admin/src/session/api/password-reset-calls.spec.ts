import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ POST: post }) }));

import { requestPasswordResetCode, resetPasswordWithCode } from './password-reset-calls';

const tooMany = (headers: Record<string, string>) => ({
  data: undefined,
  response: new Response(null, { status: 429, headers }),
});

beforeEach(() => post.mockReset());

describe('requestPasswordResetCode', () => {
  it('returns the challenge id and retry delay on 202', async () => {
    post.mockResolvedValue({
      data: { challenge_id: 'ch-1', retry_after: 60 },
      response: new Response(null, { status: 202 }),
    });
    expect(await requestPasswordResetCode('owner@example.invalid', 'ar')).toEqual({
      kind: 'accepted',
      challengeId: 'ch-1',
      retryAfter: 60,
    });
  });

  it.each([
    ['unavailable on 503', 503, 'passwordReset.unavailable'],
    ['unexpected on 500', 500, 'admin.unexpected'],
  ] as const)('maps %s without a retry delay', async (_name, status, key) => {
    post.mockResolvedValue({ data: undefined, response: new Response(null, { status }) });
    expect(await requestPasswordResetCode('owner@example.invalid', 'ar')).toEqual({
      kind: 'error',
      key,
    });
  });

  it('maps a thrown network failure to unexpected', async () => {
    post.mockImplementationOnce(async () => {
      throw new Error('network down');
    });
    expect(await requestPasswordResetCode('owner@example.invalid', 'ar')).toEqual({
      kind: 'error',
      key: 'admin.unexpected',
    });
  });
});

describe('resetPasswordWithCode', () => {
  const input = { challengeId: 'ch-1', code: '123456', newPassword: 'a-new-password' };

  it('returns done when the API accepts the reset', async () => {
    post.mockResolvedValue({ error: undefined, response: new Response(null, { status: 200 }) });
    expect(await resetPasswordWithCode(input)).toEqual({ kind: 'done' });
  });

  it.each([
    ['401 OTP_INVALID to invalidCode', 401, { code: 'OTP_INVALID' }, 'passwordReset.invalidCode'],
    ['429 to tooMany', 429, { code: 'TOO_MANY_REQUESTS' }, 'passwordReset.tooMany'],
    ['503 to unavailable', 503, { code: 'OTP_UNAVAILABLE' }, 'passwordReset.unavailable'],
    ['500 to unexpected', 500, { code: 'INTERNAL' }, 'admin.unexpected'],
    [
      '400 without OTP_INVALID to unexpected',
      400,
      { code: 'VALIDATION_ERROR' },
      'admin.unexpected',
    ],
  ] as const)('maps %s', async (_name, status, error, key) => {
    post.mockResolvedValue({ error, response: new Response(null, { status }) });
    expect(await resetPasswordWithCode(input)).toEqual({ kind: 'error', key });
  });

  it('maps a thrown network failure to unexpected', async () => {
    post.mockImplementationOnce(async () => {
      throw new Error('network down');
    });
    expect(await resetPasswordWithCode(input)).toEqual({ kind: 'error', key: 'admin.unexpected' });
  });
});

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
