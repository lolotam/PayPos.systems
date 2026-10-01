import { act, renderHook } from '@testing-library/react';
import { useQueryClient } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';

import { loadPage } from '../browser/load-page';
import { QueryProvider } from './query-provider';

class TabChannel {
  static channels = new Set<TabChannel>();
  static messages: unknown[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  constructor(readonly name: string) {
    TabChannel.channels.add(this);
  }
  postMessage(data: unknown) {
    TabChannel.messages.push(data);
    for (const channel of TabChannel.channels)
      if (channel !== this && channel.name === this.name)
        channel.onmessage?.(new MessageEvent('message', { data }));
  }
  close() {
    TabChannel.channels.delete(this);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  TabChannel.channels.clear();
  TabChannel.messages.length = 0;
});

it('identity navigation broadcasts before assign, clears and reloads a second tab, and cleans its listener', async () => {
  vi.stubGlobal('BroadcastChannel', TabChannel);
  const reload = vi.fn();
  const assign = vi.fn(() => expect(TabChannel.messages).toHaveLength(1));
  vi.stubGlobal('location', { assign, reload });
  const { result, unmount } = renderHook(() => useQueryClient(), { wrapper: QueryProvider });
  const survivingClient = result.current;
  act(() => survivingClient.setQueryData(['private-inbox'], 'Previous user'));
  expect(survivingClient.getQueryData(['private-inbox'])).toBe('Previous user');
  // A different module instance models the distinct JS realm of the initiating tab.
  vi.resetModules();
  const secondTab = await import('../browser/load-page');
  act(() => secondTab.loadPage('/login'));
  expect(assign).toHaveBeenCalledExactlyOnceWith('/login');
  expect(reload).toHaveBeenCalledOnce();
  expect(survivingClient.getQueryData(['private-inbox'])).toBeUndefined();
  expect(TabChannel.messages[0]).toMatchObject({ type: 'identity-change' });
  unmount();
  expect(TabChannel.channels.size).toBe(0);
});

it('does not reload the initiating tab or react to unrelated messages', () => {
  vi.stubGlobal('BroadcastChannel', TabChannel);
  const reload = vi.fn();
  const assign = vi.fn();
  vi.stubGlobal('location', { assign, reload });
  const { unmount } = renderHook(() => useQueryClient(), { wrapper: QueryProvider });
  act(() => loadPage('/'));
  expect(assign).toHaveBeenCalledExactlyOnceWith('/');
  expect(reload).not.toHaveBeenCalled();
  for (const channel of TabChannel.channels)
    act(() => channel.onmessage?.(new MessageEvent('message', { data: { type: 'unrelated' } })));
  expect(reload).not.toHaveBeenCalled();
  unmount();
});

it.each(['missing', 'throws'] as const)(
  'keeps navigation and provider working when BroadcastChannel %s',
  (mode) => {
    vi.stubGlobal(
      'BroadcastChannel',
      mode === 'missing'
        ? undefined
        : vi.fn(function Unavailable() {
            throw new Error('Unavailable');
          }),
    );
    const assign = vi.fn();
    vi.stubGlobal('location', { assign, reload: vi.fn() });
    const { unmount } = renderHook(() => useQueryClient(), { wrapper: QueryProvider });
    expect(() => loadPage('/login')).not.toThrow();
    expect(assign).toHaveBeenCalledExactlyOnceWith('/login');
    unmount();
  },
);
