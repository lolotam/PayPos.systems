import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { expect, it, vi } from 'vitest';
import { useLeaveDecisions } from './use-leave-decisions';
import { useLeaveInbox } from './use-leave-inbox';
import {
  leaveDecisionRecord as row,
  leaveDecisionScope as scope,
  leaveId as id,
} from './leave-decision.fixture';
const api = vi.hoisted(() => ({ POST: vi.fn(), GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
function queryHarness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}
it('decision/revocation use generated paths, revision and fresh keys, invalidating the scoped employee and inbox prefix', async () => {
  api.POST.mockResolvedValue({ data: row });
  const { client, wrapper } = queryHarness();
  const invalidation = vi.spyOn(client, 'invalidateQueries');
  const view = renderHook(() => useLeaveDecisions(scope), { wrapper });
  await act(async () => {
    await view.result.current.decide.mutateAsync({
      target: { employeeId: id, leaveId: id },
      input: { decision: 'APPROVED', expected_revision: 1 },
    });
  });
  await act(async () => {
    await view.result.current.revoke.mutateAsync({
      target: { employeeId: id, leaveId: id },
      input: { expected_revision: 2, reason: 'Synthetic correction' },
    });
  });
  const calls = api.POST.mock.calls.slice(-2);
  expect(calls[0]?.[0]).toMatch(/\/decide$/);
  expect(calls[1]?.[0]).toMatch(/\/revoke$/);
  expect(calls[0]?.[1].body).toEqual({ decision: 'APPROVED', expected_revision: 1 });
  expect(calls[1]?.[1].body).toEqual({ expected_revision: 2, reason: 'Synthetic correction' });
  expect(calls[0]?.[1].params.header['Idempotency-Key']).not.toBe(
    calls[1]?.[1].params.header['Idempotency-Key'],
  );
  expect(invalidation).toHaveBeenCalledWith({ queryKey: ['leave', id, id, id] });
  view.unmount();
  client.clear();
});
it('inbox passes filters/cursor and evicts a forbidden read plus its cache on close', async () => {
  const page = {
    items: [{ ...row, status: 'PENDING', can_decide: true, can_revoke: false }],
    next_cursor: null,
    request_branch_ids: [],
  };
  api.GET.mockResolvedValue({ data: page });
  const { client, wrapper } = queryHarness();
  const filters = { limit: 20, branch_id: id, from: '2027-01-01', to: '2027-01-31', cursor: id };
  const view = renderHook(() => useLeaveInbox(scope, filters), { wrapper });
  await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
  expect(api.GET.mock.calls.at(-1)?.[1].params.query).toEqual(filters);
  api.GET.mockResolvedValue({ error: { code: 'NOT_FOUND' }, response: { status: 404 } });
  await act(async () => {
    await view.result.current.refetch();
  });
  await waitFor(() =>
    expect(
      client.getQueryCache().findAll({ queryKey: ['leave', id, id, id, 'inbox'] }),
    ).toHaveLength(0),
  );
  view.unmount();
  client.clear();
});
