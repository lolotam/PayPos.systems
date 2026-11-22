import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimSharedKey } from '../model/private-view-key';
import { WorkHttpError } from '../model/work-error';
import { privateViewCalls } from './private-view-calls';
import {
  FakeChannel,
  WALL0,
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
const newerWindow = () =>
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

describe('a wake that reaches the tab through focus alone', () => {
  it('hides first and shows only after a touch passes, even when both clocks look alive', async () => {
    const tab = openTab();
    tab.clock.wall += 1_000;
    touch.mockResolvedValue(remaining);
    focus();
    expect(tab.handlers.hide).toHaveBeenCalledOnce();
    expect(tab.handlers.show).not.toHaveBeenCalled();
    expect(tab.handlers.hide.mock.invocationCallOrder[0]).toBeLessThan(
      touch.mock.invocationCallOrder[0] ?? 0,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(tab.handlers.show).toHaveBeenCalledOnce();
    tab.stop();
  });

  it('goes to the PIN step when the server window expired during a paused monotonic clock', async () => {
    const tab = openTab();
    tab.clock.wall += 1_000;
    const refusal = new WorkHttpError('PRIVATE_VIEW_EXPIRED', 403);
    touch.mockRejectedValue(refusal);
    focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(tab.handlers.hide).toHaveBeenCalledOnce();
    expect(tab.handlers.refused).toHaveBeenCalledWith(refusal);
    expect(tab.handlers.show).not.toHaveBeenCalled();
    tab.stop();
  });

  it('sends one touch for overlapping visibilitychange, focus and persisted pageshow', async () => {
    const tab = openTab();
    touch.mockResolvedValue(remaining);
    visibility('hidden');
    visibility('visible');
    focus();
    pageshow(true);
    expect(touch).toHaveBeenCalledOnce();
    expect(tab.handlers.hide).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(0);
    expect(tab.handlers.show).toHaveBeenCalledOnce();
    focus();
    expect(touch).toHaveBeenCalledTimes(2);
    expect(tab.handlers.hide).toHaveBeenCalledTimes(2);
    tab.stop();
  });
});

describe('a trailing input touch that verification overtakes', () => {
  it('is cancelled, so the 20 second rule holds and nothing is sent after the tab stops', async () => {
    const tab = openTab();
    touch.mockResolvedValue(remaining);
    elapse(tab, 5_000);
    keydown();
    visibility('hidden');
    elapse(tab, 1_000);
    visibility('visible');
    expect(touch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(touch).toHaveBeenCalledOnce();
    tab.stop();
    elapse(tab, 30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(touch).toHaveBeenCalledOnce();
  });

  it('sends nothing when the tab is stopped while a trailing touch is pending', async () => {
    const tab = openTab();
    touch.mockResolvedValue(remaining);
    elapse(tab, 5_000);
    keydown();
    tab.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(touch).not.toHaveBeenCalled();
  });

  it('still sends the trailing touch once when nothing overtakes it', async () => {
    const tab = openTab();
    touch.mockResolvedValue(remaining);
    elapse(tab, 5_000);
    keydown();
    elapse(tab, 15_000);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(touch).toHaveBeenCalledOnce();
    tab.stop();
  });
});

describe('close signals do not depend on the shared key having been written', () => {
  it('retires a tab whose key write failed when its own window is announced closed', () => {
    const tab = openTab({ writeKey: false });
    new FakeChannel('pospay-private-view-close').postMessage({ windowId: 'win-a' });
    expect(tab.handlers.close).toHaveBeenCalledExactlyOnceWith('self');
  });

  it('retires a tab whose key write failed when another window takes the storage key', () => {
    const tab = openTab({ writeKey: false });
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'pospay-private-view-window',
        oldValue: null,
        newValue: JSON.stringify({
          windowId: 'win-b',
          sessionRef: 'session-1',
          windowSeq: '2',
          idleWallAt: WALL0 + 60_000,
          capWallAt: WALL0 + 300_000,
        }),
      }),
    );
    expect(tab.handlers.close).toHaveBeenCalledExactlyOnceWith('self');
  });
});

describe('the current-window fence', () => {
  it('lets a live window through and refuses a response of another window id without closing', () => {
    const tab = openTab();
    expect(tab.fence('win-a', tab.epoch())).toBe(true);
    expect(tab.fence('win-old', tab.epoch())).toBe(false);
    expect(tab.handlers.close).not.toHaveBeenCalled();
    tab.stop();
  });

  it('retires the tab before any storage event when a newer window already owns the key', () => {
    const tab = openTab();
    newerWindow();
    expect(tab.isCurrent('win-a')).toBe(false);
    expect(tab.handlers.close).not.toHaveBeenCalled();
    expect(tab.fence('win-a', tab.epoch())).toBe(false);
    expect(tab.handlers.close).toHaveBeenCalledExactlyOnceWith('self');
  });

  it('closes for every tab when the confirmed deadline has passed', () => {
    const tab = openTab();
    elapse(tab, 61_000);
    expect(tab.fence('win-a', tab.epoch())).toBe(false);
    expect(tab.handlers.close).toHaveBeenCalledExactlyOnceWith('all');
  });

  it('refuses everything after the tab has been stopped', () => {
    const tab = openTab();
    tab.stop();
    expect(tab.fence('win-a', 0)).toBe(false);
    expect(tab.isCurrent('win-a')).toBe(false);
  });
});
