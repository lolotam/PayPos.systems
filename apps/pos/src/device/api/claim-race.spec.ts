import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watchClaim } from './claim-loop';

const mockCredentials = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
const mockPost = vi.fn();

vi.mock('../model/device-db', () => ({
  CURRENT_DEVICE: 'current',
  deviceDb: {
    transaction: (_mode: unknown, _table: unknown, run: () => Promise<unknown>) => run(),
    credentials: {
      get: (...args: unknown[]) => mockCredentials.get(...args),
      put: (...args: unknown[]) => mockCredentials.put(...args),
      delete: (...args: unknown[]) => mockCredentials.delete(...args),
    },
  },
}));

vi.mock('@/shared/api/client', () => ({
  apiClient: () => ({ POST: (...args: unknown[]) => mockPost(...args) }),
}));

const first = {
  id: 'current',
  company_id: 'c1',
  device_id: 'd1',
  claim_secret: 'test-first-secret',
  device_token: null,
};
const replacement = { ...first, device_id: 'd2', claim_secret: 'test-second-secret' };

// A claim answered after the stored registration changed (start over, or another tab) must leave the new one alone.
describe('a late claim response', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockCredentials.get
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(first)
      .mockResolvedValue(replacement);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not write its token over a newer registration', async () => {
    mockPost.mockResolvedValueOnce({
      response: new Response(null, { status: 200 }),
      data: { device_token: 'test-stale-token' },
    });
    const onApproved = vi.fn();
    const stop = watchClaim(onApproved, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(mockCredentials.put).not.toHaveBeenCalled();
    expect(onApproved).not.toHaveBeenCalled();
    stop();
  });

  it('does not delete a newer registration when its own claim is refused', async () => {
    mockPost.mockResolvedValueOnce({
      response: new Response(null, { status: 401 }),
      error: { code: 'UNAUTHENTICATED', message_ar: 'x', message_en: 'x' },
    });
    const onRefused = vi.fn();
    const stop = watchClaim(vi.fn(), onRefused);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockCredentials.delete).not.toHaveBeenCalled();
    expect(onRefused).not.toHaveBeenCalled();
    stop();
  });
});

describe('two claims for one device', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('run one after the other, so the second sees the token instead of deleting it', async () => {
    let row: typeof first | (typeof first & { device_token: string }) | undefined = first;
    mockCredentials.get.mockReset().mockImplementation(async () => row);
    mockCredentials.put.mockImplementation(async (next: typeof row) => {
      row = next;
    });
    mockPost.mockReset().mockImplementationOnce(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            resolve({
              response: new Response(null, { status: 200 }),
              data: { device_token: 'test-approved-token' },
            });
          }, 1_000),
        ),
    );
    const approvedA = vi.fn();
    const approvedB = vi.fn();
    const stopA = watchClaim(approvedA, vi.fn());
    const stopB = watchClaim(approvedB, vi.fn());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mockPost).toHaveBeenCalledOnce();
    expect(mockCredentials.delete).not.toHaveBeenCalled();
    expect(approvedA).toHaveBeenCalledOnce();
    expect(approvedB).toHaveBeenCalledOnce();
    stopA();
    stopB();
  });
});
