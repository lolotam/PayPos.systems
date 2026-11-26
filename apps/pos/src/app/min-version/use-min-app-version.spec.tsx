import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as NativeShellModule from '@/shared/platform/native-shell';

import { useMinAppVersion } from './use-min-app-version';
import { fetchMinVersionStatus, type MinVersionStatus } from './version-fetch';

const fakes = vi.hoisted(() => ({
  listener: null as ((isActive: boolean) => void) | null,
}));

vi.mock('@/shared/platform/native-shell', async (importOriginal) => ({
  ...(await importOriginal<typeof NativeShellModule>()),
  isNativeShell: vi.fn(() => true),
}));

vi.mock('./version-fetch', () => ({
  fetchMinVersionStatus: vi.fn(async () => null),
  onAppStateChange: vi.fn((listener: (isActive: boolean) => void) => {
    fakes.listener = listener;
    return () => undefined;
  }),
}));

const STORE_URL = 'https://apps.apple.com/app/id1';
const MINUTE = 60_000;

let onlineSpy: { mockReturnValue(value: boolean): unknown; mockRestore(): void } | null = null;

function goOnline(value: boolean) {
  if (onlineSpy === null) {
    onlineSpy = vi.spyOn(navigator, 'onLine', 'get');
  }
  onlineSpy.mockReturnValue(value);
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** ردّ بيتحكم في وقت حل الـ Promise، عشان نتحكم في وقت الجواب. */
function pendingAnswers() {
  const answers: ((status: MinVersionStatus | null) => void)[] = [];
  vi.mocked(fetchMinVersionStatus).mockImplementation(
    () =>
      new Promise<MinVersionStatus | null>((resolve) => {
        answers.push(resolve);
      }),
  );
  return answers;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.listener = null;
  vi.useFakeTimers();
  goOnline(true);
  vi.mocked(fetchMinVersionStatus).mockResolvedValue({ outcome: 'ok' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  onlineSpy = null;
});

describe('the triggers of the version check', () => {
  it('reads at once on a cold start and opens normally (VER-T09)', async () => {
    const { result } = renderHook(() => useMinAppVersion());
    await flush();

    expect(fetchMinVersionStatus).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({ checking: false, blocked: false, storeUrl: null });
  });

  it('opens normally offline and reads at once when the network returns (VER-T09, VER-T10)', async () => {
    goOnline(false);
    const { result } = renderHook(() => useMinAppVersion());
    await flush();

    expect(fetchMinVersionStatus).not.toHaveBeenCalled();
    expect(result.current).toEqual({ checking: false, blocked: false, storeUrl: null });

    goOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchMinVersionStatus).toHaveBeenCalledTimes(1);
  });

  it('makes no read when the network returns within fifteen minutes of a successful read (VER-T09)', async () => {
    renderHook(() => useMinAppVersion());
    await flush();
    expect(fetchMinVersionStatus).toHaveBeenCalledTimes(1);

    goOnline(false);
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
      await vi.advanceTimersByTimeAsync(0);
    });
    goOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchMinVersionStatus).toHaveBeenCalledTimes(1);
  });

  it('clears the decision on a return to the foreground and reads again (VER-T08)', async () => {
    vi.mocked(fetchMinVersionStatus).mockResolvedValue({ outcome: 'blocked', storeUrl: STORE_URL });
    const { result } = renderHook(() => useMinAppVersion());
    await flush();
    expect(result.current.blocked).toBe(true);

    vi.mocked(fetchMinVersionStatus).mockResolvedValue({ outcome: 'ok' });
    await act(async () => {
      fakes.listener?.(true);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchMinVersionStatus).toHaveBeenCalledTimes(2);
    expect(result.current.blocked).toBe(false);
    expect(result.current.storeUrl).toBeNull();
  });
});

describe('the fifteen minute timer of the version check', () => {
  it('reads every fifteen minutes in the foreground (VER-T13)', async () => {
    renderHook(() => useMinAppVersion());
    await flush();
    expect(fetchMinVersionStatus).toHaveBeenCalledTimes(1);

    await advance(15 * MINUTE);
    expect(fetchMinVersionStatus).toHaveBeenCalledTimes(2);

    await advance(15 * MINUTE);
    expect(fetchMinVersionStatus).toHaveBeenCalledTimes(3);
  });

  it('re-arms the fifteen minute timer after a failed read (VER-T13)', async () => {
    vi.mocked(fetchMinVersionStatus).mockResolvedValue(null);
    renderHook(() => useMinAppVersion());
    await flush();
    expect(fetchMinVersionStatus).toHaveBeenCalledTimes(1);

    await advance(15 * MINUTE);

    expect(fetchMinVersionStatus).toHaveBeenCalledTimes(2);
  });

  it('stops the timer while the app is in the background (VER-T13)', async () => {
    renderHook(() => useMinAppVersion());
    await flush();

    await act(async () => {
      fakes.listener?.(false);
      await vi.advanceTimersByTimeAsync(0);
    });
    await advance(30 * MINUTE);

    expect(fetchMinVersionStatus).toHaveBeenCalledTimes(1);
  });

  it('re-arms the fifteen minute timer when the network returns before the next check (VER-T13)', async () => {
    renderHook(() => useMinAppVersion());
    await flush();
    expect(fetchMinVersionStatus).toHaveBeenCalledTimes(1);

    await advance(5 * MINUTE);
    goOnline(false);
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
      await vi.advanceTimersByTimeAsync(0);
    });

    await advance(1 * MINUTE);
    goOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMinVersionStatus).toHaveBeenCalledTimes(1);

    await advance(9 * MINUTE);
    expect(fetchMinVersionStatus).toHaveBeenCalledTimes(2);
  });
});

describe('the check after the cold start (FR-001a)', () => {
  it('keeps the app open while the check after a return to the foreground runs', async () => {
    const answers = pendingAnswers();
    const { result } = renderHook(() => useMinAppVersion());
    await flush();
    expect(result.current.checking).toBe(true);

    // فحص البداية البارد خلص من غير تحديث.
    await act(async () => {
      answers[0]?.({ outcome: 'ok' });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.checking).toBe(false);

    // الرجوع للقدام وبعدين رجوع تاني، والفحص الجديد لسه شغال.
    await act(async () => {
      fakes.listener?.(false);
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      fakes.listener?.(true);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.checking).toBe(false);
    expect(result.current.blocked).toBe(false);

    // السيرفر ردّ إن التطبيق محتاج تحديث.
    await act(async () => {
      answers[1]?.({ outcome: 'blocked', storeUrl: STORE_URL });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.blocked).toBe(true);
    expect(result.current.checking).toBe(false);
  });
});

describe('the deadlines of the version check', () => {
  it('opens normally after three seconds and still blocks on an answer at eight seconds (VER-T14)', async () => {
    const answers = pendingAnswers();
    const { result } = renderHook(() => useMinAppVersion());
    await flush();
    expect(result.current.checking).toBe(true);

    await advance(3000);
    expect(result.current.checking).toBe(false);
    expect(result.current.blocked).toBe(false);

    await advance(5000);
    await act(async () => {
      answers[0]?.({ outcome: 'blocked', storeUrl: STORE_URL });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.blocked).toBe(true);
  });

  it('discards an answer that arrives after ten seconds (VER-T14)', async () => {
    const answers = pendingAnswers();
    const { result } = renderHook(() => useMinAppVersion());
    await flush();

    await advance(11_000);
    await act(async () => {
      answers[0]?.({ outcome: 'blocked', storeUrl: STORE_URL });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.blocked).toBe(false);
  });
});

describe('the single flight of the version check', () => {
  it('keeps one pending trigger and runs one follow-up read when the running read fails (VER-T15)', async () => {
    const answers = pendingAnswers();
    renderHook(() => useMinAppVersion());
    await flush();
    expect(fetchMinVersionStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMinVersionStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      answers[0]?.(null);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchMinVersionStatus).toHaveBeenCalledTimes(2);
  });

  it('never lets an older answer lift a block set by a newer read (VER-T15)', async () => {
    const answers = pendingAnswers();
    const { result } = renderHook(() => useMinAppVersion());
    await flush();

    await act(async () => {
      fakes.listener?.(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(answers).toHaveLength(2);

    await act(async () => {
      answers[1]?.({ outcome: 'blocked', storeUrl: STORE_URL });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.blocked).toBe(true);

    await act(async () => {
      answers[0]?.({ outcome: 'ok' });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.blocked).toBe(true);
  });
});

describe('the decision when the app comes back', () => {
  it('clears the decision when the app comes back offline and checks again online (VER-T16)', async () => {
    vi.mocked(fetchMinVersionStatus).mockResolvedValue({ outcome: 'blocked', storeUrl: STORE_URL });
    const { result } = renderHook(() => useMinAppVersion());
    await flush();
    expect(result.current.blocked).toBe(true);

    goOnline(false);
    await act(async () => {
      fakes.listener?.(false);
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      fakes.listener?.(true);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.blocked).toBe(false);
    expect(result.current.checking).toBe(false);

    goOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.blocked).toBe(true);
  });
});
