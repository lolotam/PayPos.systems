import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watchClaim } from './claim-loop';

const mockCredentials = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../model/device-db', () => ({
  CURRENT_DEVICE: 'current',
  deviceDb: {
    credentials: {
      get: (...args: unknown[]) => mockCredentials.get(...args),
      put: (...args: unknown[]) => mockCredentials.put(...args),
      delete: (...args: unknown[]) => mockCredentials.delete(...args),
    },
  },
}));

const mockPost = vi.fn();

vi.mock('@/shared/api/client', () => ({
  apiClient: () => ({
    POST: (...args: unknown[]) => mockPost(...args),
  }),
}));

function testImmediateAndPeriodic(): void {
  it('claims immediately, then every 15 s while DEVICE_PENDING', async () => {
    mockCredentials.get.mockResolvedValue({
      id: 'current',
      company_id: 'c1',
      device_id: 'd1',
      claim_secret: 'test-claim-secret',
      device_token: null,
    });
    mockPost.mockResolvedValue({
      response: new Response(null, { status: 400 }),
      error: { code: 'DEVICE_PENDING', message_ar: 'قيد الانتظار', message_en: 'Pending' },
    });

    const onApproved = vi.fn();
    const onRefused = vi.fn();
    const stop = watchClaim(onApproved, onRefused);

    await vi.advanceTimersByTimeAsync(0);
    expect(mockPost).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(14_999);
    expect(mockPost).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(mockPost).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(mockPost).toHaveBeenCalledTimes(3);

    expect(onApproved).not.toHaveBeenCalled();
    expect(onRefused).not.toHaveBeenCalled();
    stop();
  });

  it('delays the next attempt by 60 s instead of 15 s on TOO_MANY_REQUESTS', async () => {
    mockCredentials.get.mockResolvedValue({
      id: 'current',
      company_id: 'c1',
      device_id: 'd1',
      claim_secret: 'test-claim-secret',
      device_token: null,
    });
    mockPost.mockResolvedValue({
      response: new Response(null, { status: 429 }),
      error: { code: 'TOO_MANY_REQUESTS', message_ar: 'طلبات كثيرة', message_en: 'Too many requests' },
    });

    const onApproved = vi.fn();
    const onRefused = vi.fn();
    const stop = watchClaim(onApproved, onRefused);

    await vi.advanceTimersByTimeAsync(0);
    expect(mockPost).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(mockPost).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(44_999);
    expect(mockPost).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(mockPost).toHaveBeenCalledTimes(2);

    stop();
  });
}

function testRefusalAndApproval(): void {
  it('clears credentials, notifies onRefused and stops polling on UNAUTHENTICATED', async () => {
    mockCredentials.get.mockResolvedValue({
      id: 'current',
      company_id: 'c1',
      device_id: 'd1',
      claim_secret: 'test-claim-secret',
      device_token: null,
    });
    mockPost.mockResolvedValue({
      response: new Response(null, { status: 401 }),
      error: { code: 'UNAUTHENTICATED', message_ar: 'غير مصرح', message_en: 'Unauthenticated' },
    });

    const onApproved = vi.fn();
    const onRefused = vi.fn();
    const stop = watchClaim(onApproved, onRefused);

    await vi.advanceTimersByTimeAsync(0);
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockCredentials.delete).toHaveBeenCalledWith('current');
    expect(onRefused).toHaveBeenCalledOnce();
    expect(onApproved).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockPost).toHaveBeenCalledTimes(1);
    stop();
  });

  it('writes token, clears claim secret, calls onApproved once and stops polling on success', async () => {
    mockCredentials.get.mockResolvedValue({
      id: 'current',
      company_id: 'c1',
      device_id: 'd1',
      claim_secret: 'test-claim-secret',
      device_token: null,
    });
    mockPost.mockResolvedValue({
      response: new Response(null, { status: 200 }),
      data: { device_token: 'test-approved-token' },
    });

    const onApproved = vi.fn();
    const onRefused = vi.fn();
    const stop = watchClaim(onApproved, onRefused);

    await vi.advanceTimersByTimeAsync(0);
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockCredentials.put).toHaveBeenCalledWith({
      id: 'current',
      company_id: 'c1',
      device_id: 'd1',
      claim_secret: null,
      device_token: 'test-approved-token',
    });
    expect(onApproved).toHaveBeenCalledOnce();
    expect(onRefused).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockPost).toHaveBeenCalledTimes(1);
    stop();
  });
}

function testCancellationAndShortCircuit(): void {
  it('cancels the pending timer when stop function is called', async () => {
    mockCredentials.get.mockResolvedValue({
      id: 'current',
      company_id: 'c1',
      device_id: 'd1',
      claim_secret: 'test-claim-secret',
      device_token: null,
    });
    mockPost.mockResolvedValue({
      response: new Response(null, { status: 400 }),
      error: { code: 'DEVICE_PENDING', message_ar: 'قيد الانتظار', message_en: 'Pending' },
    });

    const onApproved = vi.fn();
    const onRefused = vi.fn();
    const stop = watchClaim(onApproved, onRefused);

    await vi.advanceTimersByTimeAsync(0);
    expect(mockPost).toHaveBeenCalledTimes(1);

    stop();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('short-circuits to approved without making an API request if token is already stored', async () => {
    mockCredentials.get.mockResolvedValue({
      id: 'current',
      company_id: 'c1',
      device_id: 'd1',
      claim_secret: null,
      device_token: 'test-existing-token',
    });

    const onApproved = vi.fn();
    const onRefused = vi.fn();
    const stop = watchClaim(onApproved, onRefused);

    await vi.advanceTimersByTimeAsync(0);
    expect(onApproved).toHaveBeenCalledOnce();
    expect(mockPost).not.toHaveBeenCalled();
    stop();
  });
}

describe('watchClaim', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  testImmediateAndPeriodic();
  testRefusalAndApproval();
  testCancellationAndShortCircuit();
});
