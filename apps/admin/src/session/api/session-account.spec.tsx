import { act, renderHook, waitFor } from '@testing-library/react';
import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/shared/api/query-client';
import { useSessionAccount, useSessionIdentity, useSessionUser } from './use-session';

const getSession = vi.hoisted(() => vi.fn());
vi.mock('./browser-client', () => ({ browserAuthClient: () => ({ getSession }) }));
afterEach(() => getSession.mockReset());

it('shares the existing session query and replaces account presentation with the verified identity', async () => {
  const client = createQueryClient();
  const first = {
    id: '01920000-0000-7000-8000-000000000001',
    email: 'first@example.test',
    name: 'Synthetic First',
  };
  const second = {
    id: '01920000-0000-7000-8000-000000000002',
    email: 'second@example.test',
    name: 'Synthetic Second',
  };
  getSession.mockResolvedValue({ data: { user: first } });
  const { result, unmount } = renderHook(
    () => ({ account: useSessionAccount(true), id: useSessionUser(true) }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  await waitFor(() => expect(result.current.account).toEqual(first));
  expect(result.current.id).toBe(first.id);
  expect(getSession).toHaveBeenCalledTimes(1);
  getSession.mockResolvedValue({ data: { user: second } });
  await act(() => client.invalidateQueries({ queryKey: ['session'] }));
  await waitFor(() => expect(result.current.account).toEqual(second));
  expect(result.current.id).toBe(second.id);
  getSession.mockResolvedValue({ error: { status: 401 } });
  await act(() => client.invalidateQueries({ queryKey: ['session'] }));
  await waitFor(() => expect(result.current.account).toBeNull());
  expect(result.current.id).toBeNull();
  unmount();
  client.clear();
});

it.each([
  [
    'a signed-in user',
    { data: { user: { id: 'user-1' } } },
    { userId: 'user-1', status: 'settled' },
  ],
  ['an anonymous visitor', { error: { status: 401 } }, { userId: null, status: 'settled' }],
  ['a failed read', { error: { status: 500 } }, { userId: null, status: 'failed' }],
])('reports the identity read of %s', async (_name, answer, expected) => {
  const client = createQueryClient();
  getSession.mockResolvedValue(answer);
  const { result, unmount } = renderHook(() => useSessionIdentity(true), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  expect(result.current).toEqual({ userId: null, status: 'pending' });
  await waitFor(() => expect(result.current).toEqual(expected));
  unmount();
  client.clear();
});

it('stays pending while the identity read is not enabled', () => {
  const { result } = renderHook(() => useSessionIdentity(false), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>
    ),
  });
  expect(result.current).toEqual({ userId: null, status: 'pending' });
});

it('reports an identity read paused offline as failed, then settles when the connection returns', async () => {
  onlineManager.setOnline(false);
  getSession.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  const { result, unmount } = renderHook(() => useSessionIdentity(true), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>
    ),
  });
  await waitFor(() => expect(result.current).toEqual({ userId: null, status: 'failed' }));
  act(() => onlineManager.setOnline(true));
  await waitFor(() => expect(result.current).toEqual({ userId: 'user-1', status: 'settled' }));
  unmount();
  onlineManager.setOnline(true);
});
