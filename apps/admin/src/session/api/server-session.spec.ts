import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSession = vi.fn();
const mockCreatePospayAuthClient = vi.fn((url: string) => {
  void url;
  return { getSession: mockGetSession };
});
const mockCookiesGetAll = vi.fn();

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: mockCookiesGetAll }),
}));

vi.mock('@pospay/auth/client', () => ({
  createPospayAuthClient: (url: string) => mockCreatePospayAuthClient(url),
}));

import { readSession } from './server-session';

describe('readSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookiesGetAll.mockReturnValue([
      { name: 'session_token', value: 'token-xyz' },
      { name: 'pospay_company_id', value: 'company-uuid' },
    ]);
  });

  it('forwards cookie header built from cookie jar with cache no-store', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { user: { id: 'u1' } }, error: null });

    await readSession();

    expect(mockGetSession).toHaveBeenCalledWith({
      fetchOptions: {
        headers: { cookie: 'session_token=token-xyz; pospay_company_id=company-uuid' },
        cache: 'no-store',
      },
    });
  });

  it('classifies as signed-in when user object is returned', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { user: { id: 'user-1' } }, error: null });
    expect(await readSession()).toEqual({ kind: 'signed-in' });
  });

  it('classifies as anonymous when no user is returned or on 401 response', async () => {
    mockGetSession.mockResolvedValueOnce({ data: null, error: null });
    expect(await readSession()).toEqual({ kind: 'anonymous' });

    mockGetSession.mockResolvedValueOnce({ data: null, error: { status: 401 } });
    expect(await readSession()).toEqual({ kind: 'anonymous' });
  });

  it('classifies as error when non-401 error is returned or getSession throws', async () => {
    mockGetSession.mockResolvedValueOnce({ data: null, error: { status: 500 } });
    expect(await readSession()).toEqual({ kind: 'error' });

    mockGetSession.mockRejectedValueOnce(new Error('Network failure'));
    expect(await readSession()).toEqual({ kind: 'error' });
  });
});
