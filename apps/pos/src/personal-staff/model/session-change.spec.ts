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
