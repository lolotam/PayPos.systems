import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  announceWindowClosed,
  claimSharedKey,
  extendSharedKey,
  observeWindowSignals,
  readSharedKey,
  removeSharedKey,
  type SharedKey,
  wallStatus,
} from './private-view-key';

const STORAGE_KEY = 'pospay-private-view-window';
const NOW = 1_000_000;
const key = (over: Partial<SharedKey> = {}): SharedKey => ({
  windowId: 'win-a',
  sessionRef: 'session-1',
  windowSeq: '1',
  idleWallAt: NOW + 60_000,
  capWallAt: NOW + 300_000,
  ...over,
});

/** قناة مزيفة: الرسالة بتوصل لكل النسخ التانية بنفس الاسم، زي تابين على نفس الجهاز. */
class FakeChannel {
  static all: FakeChannel[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  constructor(readonly name: string) {
    FakeChannel.all.push(this);
  }
  postMessage(data: unknown) {
    for (const other of FakeChannel.all)
      if (other !== this && !other.closed && other.name === this.name)
        other.onmessage?.({ data } as MessageEvent);
  }
  close() {
    this.closed = true;
  }
}

beforeEach(() => {
  FakeChannel.all = [];
  vi.stubGlobal('BroadcastChannel', FakeChannel);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('the shared key keeps only window metadata', () => {
  it('stores exactly the window id, session ref, seq and the two wall-clock instants', () => {
    expect(claimSharedKey(key(), NOW)).toBe('written');
    expect(localStorage.length).toBe(1);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(
      ['capWallAt', 'idleWallAt', 'sessionRef', 'windowId', 'windowSeq'].sort(),
    );
    expect(sessionStorage.length).toBe(0);
  });
});

describe('opening order is (session_ref, window_seq)', () => {
  it('lets a strictly greater seq of the same session overwrite and refuses an older or equal one', () => {
    claimSharedKey(key({ windowId: 'win-2', windowSeq: '2' }), NOW);
    expect(claimSharedKey(key({ windowId: 'win-1', windowSeq: '1' }), NOW)).toBe('older');
    expect(claimSharedKey(key({ windowId: 'win-x', windowSeq: '2' }), NOW)).toBe('older');
    expect(readSharedKey()).toMatchObject({ windowId: 'win-2' });
    expect(claimSharedKey(key({ windowId: 'win-10', windowSeq: '10' }), NOW)).toBe('written');
    expect(readSharedKey()).toMatchObject({ windowId: 'win-10' });
  });

  it('compares seq numerically, not as text', () => {
    claimSharedKey(key({ windowId: 'win-9', windowSeq: '9' }), NOW);
    expect(claimSharedKey(key({ windowId: 'win-10', windowSeq: '10' }), NOW)).toBe('written');
  });

  it('always overwrites for a different session, even with a lower seq', () => {
    claimSharedKey(key({ windowId: 'win-old', windowSeq: '50' }), NOW);
    const next = key({ windowId: 'win-new', sessionRef: 'session-2', windowSeq: '1' });
    expect(claimSharedKey(next, NOW)).toBe('written');
    expect(readSharedKey()).toMatchObject({ windowId: 'win-new', sessionRef: 'session-2' });
  });

  it('counts an expired key as absent whatever its session or seq', () => {
    claimSharedKey(key({ windowId: 'win-old', windowSeq: '50' }), NOW);
    const later = NOW + 61_000;
    const next = key({
      windowId: 'win-new',
      windowSeq: '1',
      idleWallAt: later + 60_000,
      capWallAt: later + 300_000,
    });
    expect(claimSharedKey(next, later)).toBe('written');
  });

  it('counts a key whose deadline is further away than the limits allow as absent', () => {
    const far = key({ windowId: 'win-far', windowSeq: '50', idleWallAt: NOW + 10 * 60_000 });
    claimSharedKey(far, NOW);
    expect(claimSharedKey(key({ windowId: 'win-new', windowSeq: '1' }), NOW)).toBe('written');
  });

  it('reports an unavailable storage instead of throwing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(claimSharedKey(key(), NOW)).toBe('unavailable');
    expect(readSharedKey()).toBe('unavailable');
  });
});

describe('wall-clock status', () => {
  it.each([
    ['live', key(), NOW],
    ['expired', key({ idleWallAt: NOW }), NOW],
    ['expired', key({ capWallAt: NOW - 1 }), NOW],
    ['clock', key({ idleWallAt: NOW + 60_001 }), NOW],
    ['clock', key({ capWallAt: NOW + 300_001 }), NOW],
  ])('is %s', (status, stored, now) => {
    expect(wallStatus(stored, now)).toBe(status);
  });
});

describe('a touch updates the key only for the same window and never lengthens the cap', () => {
  it('moves the idle instant forward and only shortens the cap', () => {
    claimSharedKey(key(), NOW);
    expect(extendSharedKey('win-a', NOW + 90_000, NOW + 400_000)).toBe('updated');
    expect(readSharedKey()).toMatchObject({ idleWallAt: NOW + 90_000, capWallAt: NOW + 300_000 });
    expect(extendSharedKey('win-a', NOW + 90_000, NOW + 200_000)).toBe('updated');
    expect(readSharedKey()).toMatchObject({ capWallAt: NOW + 200_000 });
  });

  it('reports a mismatch for another window or a missing key and writes nothing', () => {
    claimSharedKey(key({ windowId: 'win-b', windowSeq: '2' }), NOW);
    const before = localStorage.getItem(STORAGE_KEY);
    expect(extendSharedKey('win-a', NOW + 90_000, NOW + 200_000)).toBe('mismatch');
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
    localStorage.clear();
    expect(extendSharedKey('win-a', NOW + 90_000, NOW + 200_000)).toBe('mismatch');
  });
});

describe('closing removes the key only when it is still the same window', () => {
  it('leaves a newer window key alone when an older window closes late', () => {
    claimSharedKey(key({ windowId: 'win-b', windowSeq: '2' }), NOW);
    removeSharedKey('win-a');
    expect(readSharedKey()).toMatchObject({ windowId: 'win-b' });
    removeSharedKey('win-b');
    expect(readSharedKey()).toBeNull();
  });
});

describe('what a tab does with signals from other tabs', () => {
  const storageEvent = (init: StorageEventInit) =>
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, ...init }));
  const raw = (over: Partial<SharedKey>) => JSON.stringify(key(over));

  it('retires on a channel message that names its own window and ignores any other window', () => {
    const retire = vi.fn();
    const stop = observeWindowSignals('win-a', retire);
    const other = new FakeChannel('pospay-private-view-close');
    other.postMessage({ windowId: 'win-b' });
    other.postMessage({ nothing: true });
    other.postMessage('win-a');
    expect(retire).not.toHaveBeenCalled();
    other.postMessage({ windowId: 'win-a' });
    expect(retire).toHaveBeenCalledOnce();
    stop();
  });

  it('announces the closed window id on the channel and nothing else', () => {
    const received: unknown[] = [];
    const listener = new FakeChannel('pospay-private-view-close');
    listener.onmessage = (event) => received.push(event.data);
    announceWindowClosed('win-a');
    expect(received).toEqual([{ windowId: 'win-a' }]);
  });

  it('counts only a removal on the storage fallback, reading the window id from oldValue', () => {
    const retire = vi.fn();
    const stop = observeWindowSignals('win-a', retire);
    storageEvent({ oldValue: raw({ windowId: 'win-b' }), newValue: null });
    expect(retire).not.toHaveBeenCalled();
    storageEvent({ oldValue: null, newValue: null });
    expect(retire).not.toHaveBeenCalled();
    storageEvent({ oldValue: raw({ windowId: 'win-a' }), newValue: null });
    expect(retire).toHaveBeenCalledOnce();
    stop();
  });

  it('retires when a newer window replaces the key but not when the same window is touched', () => {
    const retire = vi.fn();
    const stop = observeWindowSignals('win-a', retire);
    storageEvent({ newValue: raw({ windowId: 'win-a', idleWallAt: NOW + 70_000 }) });
    expect(retire).not.toHaveBeenCalled();
    storageEvent({ newValue: raw({ windowId: 'win-b', windowSeq: '2' }) });
    expect(retire).toHaveBeenCalledOnce();
    stop();
  });

  it('ignores other storage keys and stops listening after the stop function', () => {
    const retire = vi.fn();
    const stop = observeWindowSignals('win-a', retire);
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: null }));
    expect(retire).not.toHaveBeenCalled();
    stop();
    storageEvent({ oldValue: raw({ windowId: 'win-a' }), newValue: null });
    expect(retire).not.toHaveBeenCalled();
    expect(FakeChannel.all.every((channel) => channel.closed)).toBe(true);
  });
});
