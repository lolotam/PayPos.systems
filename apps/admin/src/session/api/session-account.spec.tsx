import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/shared/api/query-client';
import { useSessionAccount, useSessionUser } from './use-session';

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
