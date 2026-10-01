import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { bootDevice } from './boot-device';

const mockCredentials = {
  get: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../model/device-db', () => ({
  CURRENT_DEVICE: 'current',
  deviceDb: {
    credentials: {
      get: (...args: unknown[]) => mockCredentials.get(...args),
      delete: (...args: unknown[]) => mockCredentials.delete(...args),
    },
  },
}));

const mockGet = vi.fn();

vi.mock('@/shared/api/client', () => ({
  apiClient: () => ({
    GET: (...args: unknown[]) => mockGet(...args),
  }),
}));

let queryClient: QueryClient;

function testWithoutToken(): void {
  it('returns pairing screen with no notice when no credentials exist', async () => {
    mockCredentials.get.mockResolvedValue(undefined);

    const state = await bootDevice(queryClient);

    expect(state).toEqual({ kind: 'pairing', notice: null });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('returns waiting screen when only a claim secret exists', async () => {
    mockCredentials.get.mockResolvedValue({
      id: 'current',
      company_id: 'c1',
      device_id: 'd1',
      claim_secret: 'test-secret',
      device_token: null,
    });

    const state = await bootDevice(queryClient);

    expect(state).toEqual({ kind: 'waiting' });
    expect(mockGet).not.toHaveBeenCalled();
  });
}

function testWithValidToken(): void {
  it('returns ready screen with branch id when token is valid and GET /v1/devices/me returns 200', async () => {
    mockCredentials.get.mockResolvedValue({
      id: 'current',
      company_id: 'c1',
      device_id: 'd1',
      claim_secret: null,
      device_token: 'test-token',
    });
    mockGet.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      data: {
        device_id: 'd1',
        company_id: 'c1',
        branch_id: '01923f66-3d2b-7c00-8000-000000000001',
      },
    });

    const state = await bootDevice(queryClient);

    expect(state).toEqual({
      kind: 'ready',
      branchId: '01923f66-3d2b-7c00-8000-000000000001',
    });
    expect(mockCredentials.delete).not.toHaveBeenCalled();
  });
}

function testRejections(): void {
  it('clears credentials and returns pairing with removed notice on 401 UNAUTHENTICATED', async () => {
    mockCredentials.get.mockResolvedValue({
      id: 'current',
      company_id: 'c1',
      device_id: 'd1',
      claim_secret: null,
      device_token: 'test-token',
    });
    mockGet.mockResolvedValue({
      response: new Response(null, { status: 401 }),
      error: { code: 'UNAUTHENTICATED', message_ar: 'غير مصرح', message_en: 'Unauthenticated' },
    });

    const state = await bootDevice(queryClient);

    expect(mockCredentials.delete).toHaveBeenCalledWith('current');
    expect(state).toEqual({ kind: 'pairing', notice: 'removed' });
  });

  it('clears credentials and returns pairing with removed notice on 403 FORBIDDEN', async () => {
    mockCredentials.get.mockResolvedValue({
      id: 'current',
      company_id: 'c1',
      device_id: 'd1',
      claim_secret: null,
      device_token: 'test-token',
    });
    mockGet.mockResolvedValue({
      response: new Response(null, { status: 403 }),
      error: { code: 'FORBIDDEN', message_ar: 'محظور', message_en: 'Forbidden' },
    });

    const state = await bootDevice(queryClient);

    expect(mockCredentials.delete).toHaveBeenCalledWith('current');
    expect(state).toEqual({ kind: 'pairing', notice: 'removed' });
  });
}

function testNetworkFailure(): void {
  it('returns offline without clearing credentials when a network failure occurs', async () => {
    mockCredentials.get.mockResolvedValue({
      id: 'current',
      company_id: 'c1',
      device_id: 'd1',
      claim_secret: null,
      device_token: 'test-token',
    });
    mockGet.mockRejectedValue(new TypeError('Failed to fetch'));

    const state = await bootDevice(queryClient);

    expect(state).toEqual({ kind: 'offline' });
    expect(mockCredentials.delete).not.toHaveBeenCalled();
  });
}

describe('bootDevice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  testWithoutToken();
  testWithValidToken();
  testRejections();
  testNetworkFailure();
});
