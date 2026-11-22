import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openedDeadlines } from '../model/private-view-deadline';
import { claimSharedKey, readSharedKey } from '../model/private-view-key';
import { WorkHttpError } from '../model/work-error';
import { type ClockHandlers, startPrivateViewClock } from './private-view-clock';
import { privateViewCalls } from './private-view-calls';

vi.mock('./private-view-calls', () => ({ privateViewCalls: { touch: vi.fn(), close: vi.fn() } }));

const touch = vi.mocked(privateViewCalls.touch);
const WALL0 = 1_700_000_000_000;
const remaining = { idle_remaining_ms: 60_000, cap_remaining_ms: 300_000 };

/** تاب واحد: ساعتين بيتحركوا بإيدينا، وردود فعل مراقَبة، ومفتاح مشترك اتكتب بالفتح. */
function openTab(options: { windowId?: string; shared?: boolean } = {}) {
  const windowId = options.windowId ?? 'win-a';
  const clock = { mono: 0, wall: WALL0 };
  const handlers = {
    hide: vi.fn(),
    show: vi.fn(),
    close: vi.fn(),
    refused: vi.fn(),
  } satisfies ClockHandlers;
  const shared = options.shared ?? true;
  if (shared)
    claimSharedKey(
      {
        windowId,
        sessionRef: 'session-1',
        windowSeq: '1',
        idleWallAt: WALL0 + remaining.idle_remaining_ms,
        capWallAt: WALL0 + remaining.cap_remaining_ms,
      },
      WALL0,
    );
  const stop = startPrivateViewClock(
    {
      windowId,
      deadlines: openedDeadlines(0, remaining),
      sentWall: WALL0,
      shared,
    },
    handlers,
    { mono: () => clock.mono, wall: () => clock.wall },
  );
  return { clock, handlers, stop };
}

const visibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};
const pageshow = (persisted: boolean) =>
  window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted }));
const elapse = (tab: ReturnType<typeof openTab>, ms: number) => {
  tab.clock.mono += ms;
  tab.clock.wall += ms;
};

class FakeChannel {
  static all: FakeChannel[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  constructor(readonly name: string) {
    FakeChannel.all.push(this);
  }
  postMessage(data: unknown) {
    for (const other of FakeChannel.all)
      if (other !== this && !other.closed) other.onmessage?.({ data } as MessageEvent);
  }
  close() {
    this.closed = true;
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeChannel.all = [];
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  touch.mockReset();
  visibility('visible');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('a tab that returns to the foreground before its deadline', () => {
  it('hides first, then shows again only after a touch passes and records it in the key', async () => {
    const tab = openTab();
    let pass: (value: typeof remaining) => void = () => undefined;
    touch.mockReturnValue(new Promise((resolve) => (pass = resolve)));
    visibility('hidden');
    elapse(tab, 10_000);
    visibility('visible');
    expect(tab.handlers.hide).toHaveBeenCalledOnce();
    expect(touch).toHaveBeenCalledWith('win-a');
    expect(tab.handlers.show).not.toHaveBeenCalled();
    pass(remaining);
    await vi.advanceTimersByTimeAsync(0);
    expect(tab.handlers.show).toHaveBeenCalledOnce();
    expect(readSharedKey()).toMatchObject({ idleWallAt: WALL0 + 10_000 + 60_000 });
    tab.stop();
  });

  it('goes back to the PIN step when the touch is refused as an expired window', async () => {
    const tab = openTab();
    const refusal = new WorkHttpError('PRIVATE_VIEW_EXPIRED', 403);
    touch.mockRejectedValue(refusal);
    visibility('hidden');
    visibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(tab.handlers.hide).toHaveBeenCalledOnce();
    expect(tab.handlers.refused).toHaveBeenCalledWith(refusal);
    expect(tab.handlers.show).not.toHaveBeenCalled();
    tab.stop();
  });

  it('closes only itself when the touch cannot be confirmed at all', async () => {
    const tab = openTab();
    touch.mockRejectedValue(new TypeError('offline'));
    visibility('hidden');
    visibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(tab.handlers.close).toHaveBeenCalledExactlyOnceWith('self');
    expect(tab.handlers.show).not.toHaveBeenCalled();
  });

  it('treats a visibility change that never hid the tab as nothing to re-check', () => {
    const tab = openTab();
    visibility('visible');
    expect(tab.handlers.hide).not.toHaveBeenCalled();
    expect(touch).not.toHaveBeenCalled();
    tab.stop();
  });

  it('restores from the back-forward cache only after a touch, and a normal page show needs none', async () => {
    const tab = openTab();
    touch.mockResolvedValue(remaining);
    pageshow(false);
    expect(tab.handlers.hide).not.toHaveBeenCalled();
    pageshow(true);
    expect(tab.handlers.hide).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(0);
    expect(tab.handlers.show).toHaveBeenCalledOnce();
    tab.stop();
  });
});

describe('a tab that returns after a deadline has passed', () => {
  it.each([
    ['visibilitychange', () => visibility('visible')],
    ['pageshow with persisted', () => pageshow(true)],
    ['focus', () => window.dispatchEvent(new Event('focus'))],
  ])('closes for every tab on %s with no touch and no flash of data', (_, trigger) => {
    const tab = openTab();
    visibility('hidden');
    elapse(tab, 61_000);
    trigger();
    expect(tab.handlers.close).toHaveBeenCalledExactlyOnceWith('all');
    expect(tab.handlers.hide).not.toHaveBeenCalled();
    expect(touch).not.toHaveBeenCalled();
  });

  it('notices a passed shared wall-clock deadline even when the tab monotonic clock paused', () => {
    const tab = openTab();
    tab.clock.wall += 61_000;
    window.dispatchEvent(new Event('focus'));
    expect(tab.handlers.close).toHaveBeenCalledExactlyOnceWith('all');
  });

  it('closes when the device clock moved back before the send instant', () => {
    const tab = openTab();
    tab.clock.wall = WALL0 - 1;
    window.dispatchEvent(new Event('focus'));
    expect(tab.handlers.close).toHaveBeenCalledExactlyOnceWith('all');
  });

  it('closes when the stored deadline is further away than the limits allow', () => {
    const tab = openTab();
    tab.clock.wall = WALL0 + 1_000;
    localStorage.setItem(
      'pospay-private-view-window',
      JSON.stringify({
        windowId: 'win-a',
        sessionRef: 'session-1',
        windowSeq: '1',
        idleWallAt: WALL0 + 10 * 60_000,
        capWallAt: WALL0 + 20 * 60_000,
      }),
    );
    vi.advanceTimersByTime(5_000);
    expect(tab.handlers.close).toHaveBeenCalledWith('all');
  });
});

describe('a tab compares itself with the shared key', () => {
  it.each([
    ['the key is missing', () => localStorage.clear()],
    [
      'a newer window owns the key',
      () => {
        localStorage.clear();
        claimSharedKey(
          {
            windowId: 'win-b',
            sessionRef: 'session-1',
            windowSeq: '2',
            idleWallAt: WALL0 + 60_000,
            capWallAt: WALL0 + 300_000,
          },
          WALL0,
        );
      },
    ],
  ])('clears only itself when %s', (_, change) => {
    const tab = openTab();
    change();
    window.dispatchEvent(new Event('focus'));
    expect(tab.handlers.close).toHaveBeenCalledExactlyOnceWith('self');
  });

  it('keeps running beside an unavailable storage and trusts only its own deadlines', () => {
    const tab = openTab({ shared: false });
    window.dispatchEvent(new Event('focus'));
    expect(tab.handlers.close).not.toHaveBeenCalled();
    elapse(tab, 61_000);
    window.dispatchEvent(new Event('focus'));
    expect(tab.handlers.close).toHaveBeenCalledExactlyOnceWith('all');
  });

  it('discards a passing touch whose window is no longer the key window', async () => {
    const tab = openTab();
    touch.mockResolvedValue(remaining);
    localStorage.clear();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    elapse(tab, 20_000);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(tab.handlers.close).toHaveBeenCalledExactlyOnceWith('self');
  });
});

describe('a close signal from another tab', () => {
  it('clears this tab only for its own window and never for another window', () => {
    const tab = openTab({ windowId: 'win-b' });
    const other = new FakeChannel('pospay-private-view-close');
    other.postMessage({ windowId: 'win-a' });
    expect(tab.handlers.close).not.toHaveBeenCalled();
    other.postMessage({ windowId: 'win-b' });
    expect(tab.handlers.close).toHaveBeenCalledExactlyOnceWith('self');
  });

  it('stops reacting to anything after the tab is stopped', () => {
    const tab = openTab();
    tab.stop();
    visibility('hidden');
    elapse(tab, 61_000);
    visibility('visible');
    window.dispatchEvent(new Event('focus'));
    new FakeChannel('pospay-private-view-close').postMessage({ windowId: 'win-a' });
    vi.advanceTimersByTime(60_000);
    expect(tab.handlers.close).not.toHaveBeenCalled();
    expect(tab.handlers.hide).not.toHaveBeenCalled();
  });
});
