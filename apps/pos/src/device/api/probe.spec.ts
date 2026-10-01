import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { probeDevice } from './probe';

const mockGet = vi.fn();

vi.mock('@/shared/api/client', () => ({
  apiClient: () => ({
    GET: (...args: unknown[]) => mockGet(...args),
  }),
}));

describe('probeDevice', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it('returns ready with branch id when device identity succeeds', async () => {
    mockGet.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      data: {
        device_id: 'd1',
        company_id: 'c1',
        branch_id: '01923f66-3d2b-7c00-8000-000000000001',
      },
    });

    const result = await probeDevice(queryClient);

    expect(result).toEqual({
      kind: 'ready',
      branchId: '01923f66-3d2b-7c00-8000-000000000001',
    });
  });

  it('returns rejected when response status is 401 or 403', async () => {
    mockGet.mockResolvedValueOnce({
      response: new Response(null, { status: 401 }),
      error: { code: 'UNAUTHENTICATED', message_ar: 'غير مصرح', message_en: 'Unauthenticated' },
    });

    const result401 = await probeDevice(queryClient);
    expect(result401).toEqual({ kind: 'rejected' });

    queryClient.clear();

    mockGet.mockResolvedValueOnce({
      response: new Response(null, { status: 403 }),
      error: { code: 'FORBIDDEN', message_ar: 'محظور', message_en: 'Forbidden' },
    });

    const result403 = await probeDevice(queryClient);
    expect(result403).toEqual({ kind: 'rejected' });
  });

  it('returns offline when request fails due to network error', async () => {
    mockGet.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await probeDevice(queryClient);

    expect(result).toEqual({ kind: 'offline' });
  });
});
