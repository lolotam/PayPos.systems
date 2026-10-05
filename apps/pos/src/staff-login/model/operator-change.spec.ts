import { present } from '../../../../../packages/db/test/present';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { announceOperatorChange, observeOperatorChange } from './operator-change';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
describe('operator changes invalidate private tabs without sharing credentials', () => {
  it('uses the storage fallback when BroadcastChannel is unavailable', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const clear = vi.fn(),
      stop = observeOperatorChange(clear);
    announceOperatorChange();
    expect(localStorage.getItem('pospay-staff-operator-change')).toMatch(/^\d+$/);
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'pospay-staff-operator-change', newValue: 'synthetic' }),
    );
    expect(clear).toHaveBeenCalledOnce();
    stop();
    window.dispatchEvent(new StorageEvent('storage', { key: 'pospay-staff-operator-change' }));
    expect(clear).toHaveBeenCalledOnce();
  });
  it('broadcasts a structural signal and closes each observer', () => {
    const postMessage = vi.fn(),
      close = vi.fn();
    let receiver: { onmessage: (() => void) | null } | undefined;
    class SyntheticChannel {
      onmessage: (() => void) | null = null;
      postMessage = postMessage;
      close = close;
      constructor() {
        receiver = { onmessage: () => this.onmessage?.() };
      }
    }
    vi.stubGlobal('BroadcastChannel', SyntheticChannel);
    const clear = vi.fn(),
      stop = observeOperatorChange(clear);
    present(present(receiver).onmessage)();
    expect(clear).toHaveBeenCalledOnce();
    announceOperatorChange();
    expect(postMessage).toHaveBeenCalledWith('CHANGED');
    stop();
    expect(close).toHaveBeenCalledTimes(2);
  });
  it('blocked channels cannot interrupt local invalidation and same-millisecond changes remain distinct', () => {
    vi.stubGlobal(
      'BroadcastChannel',
      vi.fn(function () {
        throw new DOMException('Synthetic blocked channel', 'SecurityError');
      }),
    );
    const clear = vi.fn(),
      stop = observeOperatorChange(clear);
    expect(() => announceOperatorChange()).not.toThrow();
    const previous = localStorage.getItem('pospay-staff-operator-change');
    announceOperatorChange();
    expect(localStorage.getItem('pospay-staff-operator-change')).not.toBe(previous);
    window.dispatchEvent(new StorageEvent('storage', { key: 'pospay-staff-operator-change' }));
    expect(clear).toHaveBeenCalledOnce();
    stop();
  });
});
