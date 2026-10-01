import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import * as clientModule from '@/shared/api/client';
import { createQueryClient } from '@/shared/api/query-client';
import { useNotifications } from './use-notifications';

const company = '01920000-0000-7000-8000-0000000000a0';
const userA = '01920000-0000-7000-8000-0000000000f1';
const userB = '01920000-0000-7000-8000-0000000000f2';
afterEach(() => vi.restoreAllMocks());

function inbox(subject: string) {
  return {
    items: [
      {
        id: company,
        company_id: company,
        business_id: null,
        branch_id: null,
        source_event_id: company,
        template_key: 'generic_notice',
        template_revision: 1,
        locale: 'en',
        safe_parameters: [{ name: 'subject', type: 'text', value: subject }],
        created_at: '2026-10-01T12:00:00Z',
        read_at: null,
      },
    ],
    next_cursor: null,
  };
}

function response(data: unknown) {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}

it('never exposes A inbox or badge under B while the same QueryClient survives an account switch', async () => {
  const client = createQueryClient();
  let activeUser = userA;
  let finishB: (() => void) | undefined;
  vi.spyOn(clientModule, 'apiClient').mockImplementation(clientModule.createApiClient);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const count = new URL((input as Request).url).pathname.endsWith('/unread-count');
    if (activeUser === userA) return response(count ? { count: 7 } : inbox('Account A'));
    if (count) return response({ count: 2 });
    return new Promise<Response>((resolve) => {
      finishB = () => resolve(response(inbox('Account B')));
    });
  });
  const observed: { user: string; subject: string | undefined }[] = [];
  const { result, rerender, unmount } = renderHook(
    ({ user }) => {
      const value = useNotifications(company, true, user);
      observed.push({ user, subject: value.list.data?.items[0]?.safe_parameters[0].value });
      return value;
    },
    {
      initialProps: { user: userA },
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  await waitFor(() => expect(result.current.list.data).toEqual(inbox('Account A')));
  expect(result.current.count.data).toEqual({ count: 7 });
  activeUser = userB;
  rerender({ user: userB });
  expect(result.current.list.data).toBeUndefined();
  expect(result.current.count.data).toBeUndefined();
  await waitFor(() => expect(finishB).toBeDefined());
  await act(async () => finishB?.());
  await waitFor(() => expect(result.current.list.data).toEqual(inbox('Account B')));
  expect(
    observed
      .filter((entry) => entry.user === userB)
      .every((entry) => entry.subject !== 'Account A'),
  ).toBe(true);
  expect(result.current.count.data).toEqual({ count: 2 });
  unmount();
  client.clear();
});

it.each([
  { company, user: null },
  { company: undefined, user: userA },
])('does not fetch until company and user are known: %j', async (identity) => {
  const client = createQueryClient();
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ count: 0 }));
  vi.spyOn(clientModule, 'apiClient').mockImplementation(clientModule.createApiClient);
  const { result, unmount } = renderHook(
    () => useNotifications(identity.company, true, identity.user),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  await act(async () => undefined);
  expect(result.current.count.fetchStatus).toBe('idle');
  expect(result.current.list.fetchStatus).toBe('idle');
  expect(fetchSpy).not.toHaveBeenCalled();
  unmount();
  client.clear();
});

it('invalidates only the initiating company/user after a read completes during an account switch', async () => {
  const client = createQueryClient();
  const keyA = ['me', 'notifications', company, userA, 'count'];
  const keyB = ['me', 'notifications', company, userB, 'count'];
  client.setQueryData(keyA, { count: 7 });
  client.setQueryData(keyB, { count: 2 });
  let finishRead: (() => void) | undefined;
  vi.spyOn(clientModule, 'apiClient').mockImplementation(clientModule.createApiClient);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if ((input as Request).method === 'POST')
      return new Promise<Response>((resolve) => {
        finishRead = () => resolve(response({ ok: true }));
      });
    return response(
      new URL((input as Request).url).pathname.endsWith('/unread-count')
        ? { count: 7 }
        : inbox('Account A'),
    );
  });
  const { result, rerender, unmount } = renderHook(
    ({ user }) => useNotifications(company, false, user),
    {
      initialProps: { user: userA },
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  act(() => result.current.read.mutate(undefined));
  await waitFor(() => expect(finishRead).toBeDefined());
  rerender({ user: userB });
  // Keep both entries inactive so invalidation remains observable rather than refetching.
  unmount();
  await act(async () => finishRead?.());
  await waitFor(() => expect(client.getQueryState(keyA)?.isInvalidated).toBe(true));
  expect(client.getQueryState(keyB)?.isInvalidated).toBe(false);
  client.clear();
});
