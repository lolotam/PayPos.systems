import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { createQueryClient } from '@/shared/api/query-client';
import * as calls from './session-calls';
import * as hooks from './use-session';

const getSession = vi.hoisted(() => vi.fn());
vi.mock('./browser-client', () => ({ browserAuthClient: () => ({ getSession }) }));
afterEach(() => getSession.mockReset());
const user = '01920000-0000-7000-8000-0000000000f1';

it.each([
  { response: { data: { user: { id: user } } }, expected: user },
  { response: { data: null }, expected: null },
  { response: { error: { status: 401 } }, expected: null },
])(
  'reads session identity without changing the in/out contract: %j',
  async ({ response, expected }) => {
    expect(typeof calls.readSessionUserId).toBe('function');
    getSession.mockResolvedValue(response);
    expect(await calls.readSessionUserId()).toBe(expected);
    expect(await calls.loadBrowserSession()).toBe(expected === null ? 'out' : 'in');
  },
);

it('propagates failed session verification instead of treating a server error as anonymous', async () => {
  expect(typeof calls.readSessionUserId).toBe('function');
  const error = { status: 503 };
  getSession.mockResolvedValue({ error });
  await expect(calls.readSessionUserId()).rejects.toEqual(error);
});

it('waits for browser mounting and returns null after the authenticated user disappears', async () => {
  expect(typeof hooks.useSessionUser).toBe('function');
  const client = createQueryClient();
  getSession.mockResolvedValue({ data: { user: { id: user } } });
  const { result, rerender, unmount } = renderHook(({ enabled }) => hooks.useSessionUser(enabled), {
    initialProps: { enabled: false },
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  expect(result.current).toBeNull();
  expect(getSession).not.toHaveBeenCalled();
  rerender({ enabled: true });
  await waitFor(() => expect(result.current).toBe(user));
  getSession.mockResolvedValue({ error: { status: 401 } });
  await act(() => client.invalidateQueries({ queryKey: ['session'] }));
  await waitFor(() => expect(result.current).toBeNull());
  unmount();
  client.clear();
});
