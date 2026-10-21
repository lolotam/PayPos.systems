import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { id, scope } from './session-recording-result.fixture';
import { useRecordPermission } from './use-record-permission';

const state = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));

const page = { data: { items: [], next_cursor: null }, response: { status: 200 } };
const down = { error: { code: 'INTERNAL_ERROR' }, response: { status: 500 } };

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    client,
    ...renderHook((next: typeof scope) => useRecordPermission(next, true), {
      wrapper,
      initialProps: scope,
    }),
  };
}

it('waits again for the first answer of a new branch, and keeps a settled decision through a failed refetch', async () => {
  let answerOther: (value: unknown) => void = () => undefined;
  const other = { ...scope, branchId: id(33) };
  state.get.mockImplementation((_path: string, init: { params: { path: { branchId: string } } }) =>
    init.params.path.branchId === other.branchId
      ? new Promise((resolve) => (answerOther = resolve))
      : Promise.resolve(page),
  );
  const view = mount();
  await waitFor(() => expect(view.result.current.waiting).toBe(false));
  expect(view.result.current.refused).toBe(false);
  state.get.mockImplementationOnce(() => Promise.resolve(down));
  await act(async () => {
    await view.client.refetchQueries({ queryKey: ['session-services'] });
  });
  expect(view.result.current).toMatchObject({ waiting: false, refused: false, failed: null });
  view.rerender(other);
  await waitFor(() => expect(view.result.current.waiting).toBe(true));
  await act(async () => answerOther(page));
  await waitFor(() => expect(view.result.current.waiting).toBe(false));
});
