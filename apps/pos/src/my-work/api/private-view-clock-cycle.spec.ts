import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { privateViewCalls } from './private-view-calls';
import {
  FakeChannel,
  elapse,
  openTab,
  pageshow,
  remaining,
  visibility,
} from './private-view-clock-kit';

vi.mock('./private-view-calls', () => ({ privateViewCalls: { touch: vi.fn(), close: vi.fn() } }));

const touch = vi.mocked(privateViewCalls.touch);
const focus = () => window.dispatchEvent(new Event('focus'));
const keydown = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
const settle = () => vi.advanceTimersByTimeAsync(0);

/** رد لمسة بنتحكم في لحظة نجاحه أو فشله. */
function deferred() {
  let pass: (value: typeof remaining) => void = () => undefined;
  let fail: (reason: unknown) => void = () => undefined;
  const promise = new Promise<typeof remaining>((resolve, reject) => {
    pass = resolve;
    fail = reject;
  });
  return { promise, pass, fail };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeChannel.all = [];
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  touch.mockReset();
  visibility('visible');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('H1: every visibility cycle needs its own touch, with no elapsed-time shortcut', () => {
  it('hides again and waits for a new touch when the tab returns 800 ms after a completed one', async () => {
    const tab = openTab();
    const first = deferred();
    const second = deferred();
    touch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    visibility('hidden');
    visibility('visible');
    first.pass(remaining);
    await settle();
    expect(tab.handlers.show).toHaveBeenCalledOnce();
    elapse(tab, 400);
    visibility('hidden');
    elapse(tab, 400);
    visibility('visible');
    expect(touch).toHaveBeenCalledTimes(2);
    expect(tab.handlers.hide).toHaveBeenCalledTimes(2);
    expect(tab.fence('win-a', 0)).toBe(false);
    expect(tab.handlers.show).toHaveBeenCalledOnce();
    second.pass(remaining);
    await settle();
    expect(tab.handlers.show).toHaveBeenCalledTimes(2);
    expect(tab.fence('win-a', tab.epoch())).toBe(true);
    tab.stop();
  });

  it('does not let a touch sent before the second wake satisfy it, and sends a new one', async () => {
    const tab = openTab();
    const preWake = deferred();
    const postWake = deferred();
    touch.mockReturnValueOnce(preWake.promise).mockReturnValueOnce(postWake.promise);
    visibility('hidden');
    visibility('visible');
    visibility('hidden');
    visibility('visible');
    expect(touch).toHaveBeenCalledTimes(2);
    preWake.pass(remaining);
    await settle();
    expect(tab.handlers.show).not.toHaveBeenCalled();
    expect(tab.fence('win-a', tab.epoch())).toBe(false);
    postWake.pass(remaining);
    await settle();
    expect(tab.handlers.show).toHaveBeenCalledOnce();
    tab.stop();
  });
});

describe('H1: a stale touch or an overlapping event', () => {
  it('keeps rows hidden when an input touch sent before the wake answers after the restore', async () => {
    const tab = openTab();
    const inputTouch = deferred();
    const wakeTouch = deferred();
    touch.mockReturnValueOnce(inputTouch.promise).mockReturnValueOnce(wakeTouch.promise);
    elapse(tab, 20_000);
    keydown();
    expect(touch).toHaveBeenCalledOnce();
    visibility('hidden');
    visibility('visible');
    expect(touch).toHaveBeenCalledTimes(2);
    inputTouch.pass(remaining);
    await settle();
    expect(tab.handlers.show).not.toHaveBeenCalled();
    expect(tab.fence('win-a', tab.epoch())).toBe(false);
    wakeTouch.pass(remaining);
    await settle();
    expect(tab.handlers.show).toHaveBeenCalledOnce();
    tab.stop();
  });

  it('sends exactly one touch for visibilitychange, focus and pageshow of the same cycle', () => {
    const tab = openTab();
    touch.mockReturnValue(deferred().promise);
    visibility('hidden');
    visibility('visible');
    focus();
    pageshow(true);
    focus();
    expect(touch).toHaveBeenCalledOnce();
    tab.stop();
  });
});

describe('H1: reads and boundaries', () => {
  it('discards a read that started in an earlier cycle even after the tab is verified again', async () => {
    const tab = openTab();
    const readEpoch = tab.epoch();
    touch.mockResolvedValue(remaining);
    visibility('hidden');
    visibility('visible');
    await settle();
    expect(tab.handlers.show).toHaveBeenCalledOnce();
    expect(tab.fence('win-a', readEpoch)).toBe(false);
    expect(tab.fence('win-a', tab.epoch())).toBe(true);
    tab.stop();
  });

  it('hides on freeze and on pagehide, and needs a touch after resume or a persisted pageshow', async () => {
    const tab = openTab();
    touch.mockResolvedValue(remaining);
    document.dispatchEvent(new Event('freeze'));
    expect(tab.handlers.hide).toHaveBeenCalledOnce();
    expect(tab.fence('win-a', tab.epoch())).toBe(false);
    expect(touch).not.toHaveBeenCalled();
    document.dispatchEvent(new Event('resume'));
    expect(touch).toHaveBeenCalledOnce();
    await settle();
    expect(tab.handlers.show).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event('pagehide'));
    expect(tab.handlers.hide).toHaveBeenCalledTimes(2);
    pageshow(true);
    expect(touch).toHaveBeenCalledTimes(2);
    await settle();
    expect(tab.handlers.show).toHaveBeenCalledTimes(2);
    tab.stop();
  });
});

describe('H1: input and failing touches', () => {
  it('cancels a pending input touch at a boundary and sends nothing while the tab is hidden', async () => {
    const tab = openTab();
    touch.mockResolvedValue(remaining);
    elapse(tab, 5_000);
    keydown();
    visibility('hidden');
    elapse(tab, 20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(touch).not.toHaveBeenCalled();
    tab.stop();
  });

  it('closes only itself when the touch of the current cycle fails, and ignores a stale cycle failing', async () => {
    const tab = openTab();
    const stale = deferred();
    touch.mockReturnValueOnce(stale.promise);
    visibility('hidden');
    visibility('visible');
    visibility('hidden');
    stale.fail(new TypeError('offline'));
    await settle();
    expect(tab.handlers.close).not.toHaveBeenCalled();
    touch.mockRejectedValueOnce(new TypeError('offline'));
    visibility('visible');
    await settle();
    expect(tab.handlers.close).toHaveBeenCalledExactlyOnceWith('self');
    expect(tab.handlers.show).not.toHaveBeenCalled();
  });
});

describe('H2: an unreadable shared key is a local retirement, never a live window', () => {
  const unreadable = () =>
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });

  it('fails the fence and the render check and closes only this tab', () => {
    const tab = openTab();
    expect(tab.fence('win-a', tab.epoch())).toBe(true);
    unreadable();
    expect(tab.isCurrent('win-a')).toBe(false);
    expect(tab.handlers.close).not.toHaveBeenCalled();
    expect(tab.fence('win-a', tab.epoch())).toBe(false);
    expect(tab.handlers.close).toHaveBeenCalledExactlyOnceWith('self');
  });

  it('retires on the periodic check even when nothing else happens', () => {
    const tab = openTab();
    unreadable();
    vi.advanceTimersByTime(5_000);
    expect(tab.handlers.close).toHaveBeenCalledExactlyOnceWith('self');
  });

  it('does not show rows when the key becomes unreadable while the wake touch is in flight', async () => {
    const tab = openTab();
    const wakeTouch = deferred();
    touch.mockReturnValue(wakeTouch.promise);
    visibility('hidden');
    visibility('visible');
    unreadable();
    wakeTouch.pass(remaining);
    await settle();
    expect(tab.handlers.show).not.toHaveBeenCalled();
    expect(tab.handlers.close).toHaveBeenCalledExactlyOnceWith('self');
  });

  it('treats any error thrown inside a check as a local retirement', () => {
    const tab = openTab();
    Object.defineProperty(tab.clock, 'wall', {
      get: () => {
        throw new Error('clock');
      },
    });
    expect(tab.isCurrent('win-a')).toBe(false);
    focus();
    expect(tab.handlers.close).toHaveBeenCalledExactlyOnceWith('self');
    expect(tab.handlers.show).not.toHaveBeenCalled();
  });
});
