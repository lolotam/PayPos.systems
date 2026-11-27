import { afterEach, describe, expect, it, vi } from 'vitest';

import { announcePersonalChange, observePersonalChange } from './session-change';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('session-change same-tab invalidation', () => {
  it('invokes local listeners synchronously before returning from announcePersonalChange', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const events: string[] = [];
    const stop = observePersonalChange(() => events.push('cleared'));

    announcePersonalChange();
    events.push('returned');

    expect(events).toEqual(['cleared', 'returned']);
    stop();
  });
});

describe('session-change BroadcastChannel echo isolation', () => {
  it('ignores same-tab BroadcastChannel echo while accepting other-tab broadcasts', async () => {
    const subscribers = new Set<(event: MessageEvent<unknown>) => void>();
    class FakeBroadcastChannel {
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
      private readonly deliver = (event: MessageEvent<unknown>) => this.onmessage?.(event);
      constructor() {
        subscribers.add(this.deliver);
      }
      postMessage(data: unknown) {
        queueMicrotask(() => {
          for (const cb of [...subscribers]) {
            if (cb !== this.deliver) cb(new MessageEvent('message', { data }));
          }
        });
      }
      close() {
        subscribers.delete(this.deliver);
      }
    }
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    const clear = vi.fn();
    const stop = observePersonalChange(clear);

    announcePersonalChange();
    await Promise.resolve();
    expect(clear).toHaveBeenCalledTimes(1);

    const otherTab = new FakeBroadcastChannel();
    otherTab.postMessage({ type: 'CHANGED', sender: 'other-tab' });
    await Promise.resolve();
    expect(clear).toHaveBeenCalledTimes(2);
    otherTab.close();
    stop();
  });
});
