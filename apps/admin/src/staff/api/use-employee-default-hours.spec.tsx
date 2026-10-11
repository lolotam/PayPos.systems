import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useEmployeeDefaultHours } from './use-employee-default-hours';
const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
const id = '01920000-0000-7000-8000-0000000000a2';
const data = { employee_id: id, can_manage: true, branches: [] };
it('reads with scoped params, saves one branch, refreshes grids and evicts on close', async () => {
  api.GET.mockResolvedValue({ data }); api.PUT.mockResolvedValue({ data });
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const hook = renderHook(() => useEmployeeDefaultHours(id, id, id, id), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  await waitFor(() => expect(hook.result.current.current.data).toEqual(data));
  expect(api.GET.mock.calls[0]?.[1].params.header).toEqual({ 'x-company-id': id });
  await act(() => hook.result.current.save.mutateAsync({ branchId: id, input: { shifts: [] } }));
  expect(api.PUT.mock.calls[0]?.[1]).toMatchObject({ params: { path: { branchId: id } }, body: { shifts: [] } });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['schedules', id, id] });
  hook.unmount();
  expect(client.getQueryCache().findAll({ queryKey: ['employee-default-hours', id, id, id, id] })).toEqual([]);
});
