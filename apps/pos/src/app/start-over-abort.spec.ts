import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { announcePersonalChange } from '@/personal-staff/model/session-change';

import { endEmployeeSessionFirst, START_OVER_SIGN_OUT_WAIT_MS } from './link-rules';

vi.mock('@/personal-staff/push/push-disable', () => ({
  disablePushOnSignOut: vi.fn(async () => undefined),
}));
vi.mock('@/personal-staff/model/session-change', () => ({
  announcePersonalChange: vi.fn(),
}));

const fetcher = vi.fn();

/** جواب السيرفر بعد ما الطلب يخلص: الجلسة الشخصية اتوقّعت. */
const signedOut = () =>
  new Response(JSON.stringify({ status: 'SIGNED_OUT' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/** طلب واقف: بيفضل شغّال لحد ما الإشارة تلغيه، والجواب المتأخر بيتجاهل. */
function stallSignOut(): () => void {
  let late: ((response: Response) => void) | undefined;
  fetcher.mockImplementation(
    (request: Request) =>
      new Promise<Response>((resolve, reject) => {
        late = resolve;
        request.signal.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }),
  );
  return () => late?.(signedOut());
}

/** بتقولنا الخطوة اتقفلت ولا لا. */
function watch(promise: Promise<unknown>): () => boolean {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  return () => settled;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetcher);
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the back step and the stalled sign-out', () => {
  it('aborts the stalled sign-out request when the wait expires', async () => {
    vi.useFakeTimers();
    stallSignOut();

    const pending = endEmployeeSessionFirst({ kind: 'flow', role: 'employee', business: null });
    const settled = watch(pending);

    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const request = fetcher.mock.calls[0]?.[0] as Request;
    expect(request.signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(START_OVER_SIGN_OUT_WAIT_MS - 1);
    expect(request.signal.aborted).toBe(false);
    expect(settled()).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(request.signal.aborted).toBe(true);
    // التنبيه ده هو اللي بيظهر على الشاشة؛ العرض نفسه متأكد في native-entry.spec.tsx.
    await expect(pending).resolves.toEqual({
      kind: 'flow',
      role: 'employee',
      business: null,
      alert: 'roleChangeFailed',
    });
  });

  it('a late sign-out answer after the abort changes nothing', async () => {
    vi.useFakeTimers();
    const resolveLate = stallSignOut();

    const pending = endEmployeeSessionFirst({ kind: 'flow', role: 'employee', business: null });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(START_OVER_SIGN_OUT_WAIT_MS);
    await expect(pending).resolves.toMatchObject({ alert: 'roleChangeFailed' });

    resolveLate();
    await vi.advanceTimersByTimeAsync(0);

    // المتصفح بيعمل discard لـ Set-Cookie بتاع رد اتلغى، فمفيش جلسة أحدث بتتمسح.
    expect(announcePersonalChange).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not abort when the sign-out answers in time', async () => {
    vi.useFakeTimers();
    fetcher.mockResolvedValue(signedOut());

    const pending = endEmployeeSessionFirst({ kind: 'flow', role: 'employee', business: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const request = fetcher.mock.calls[0]?.[0] as Request;

    await expect(pending).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(START_OVER_SIGN_OUT_WAIT_MS * 2);

    expect(request.signal.aborted).toBe(false);
    expect(announcePersonalChange).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
