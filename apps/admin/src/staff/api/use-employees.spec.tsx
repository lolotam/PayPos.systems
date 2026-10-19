import type { ReactNode } from 'react';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useEmployeeEdit, useEmployees } from './use-employees';

const api = vi.hoisted(() => ({ GET: vi.fn(), PATCH: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
const id = '01920000-0000-7000-8000-0000000000a2';
const other = '01920000-0000-7000-8000-0000000000a3';
const record = {
  id,
  business_id: id,
  primary_branch_id: id,
  name_en: 'Synthetic',
  name_ar: null,
  role_code: 'staff' as const,
  hire_date: '2026-01-01',
  contract_end: null,
  user_id: null,
  created_at: '2026-10-03T00:00:00Z',
  branch_ids: [id],
  revision: 3,
  employee_number: 4,
};
const terms = {
  primary_branch_id: id,
  name_en: 'Changed',
  role_code: 'staff' as const,
  hire_date: '2026-01-01',
  expected_revision: 3,
  branch_ids: [id],
  branch_effective_date: '2026-10-04',
};
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}
it('server cursor and selected workspace/user remain part of paginated query requests and cache identity', async () => {
  api.GET.mockResolvedValue({ data: { items: [], next_cursor: null } });
  const { wrapper, client } = setup();
  const hook = renderHook(({ company }) => useEmployees(company, id, other, other), {
    wrapper,
    initialProps: { company: id },
  });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(api.GET).toHaveBeenCalledWith(
    '/v1/businesses/{businessId}/employees',
    expect.objectContaining({
      params: {
        header: { 'x-company-id': id },
        path: { businessId: id },
        query: { limit: 20, cursor: other },
      },
    }),
  );
  hook.rerender({ company: other });
  await waitFor(() =>
    expect(api.GET).toHaveBeenCalledWith(
      '/v1/businesses/{businessId}/employees',
      expect.objectContaining({
        params: {
          header: { 'x-company-id': other },
          path: { businessId: id },
          query: { limit: 20, cursor: other },
        },
      }),
    ),
  );
  expect(
    client
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey),
  ).toContainEqual(['employees', other, id, other, 'list', other]);
});
it('includes q in the list request and cache key only when a search is set', async () => {
  api.GET.mockResolvedValue({ data: { items: [], next_cursor: null } });
  const { wrapper, client } = setup();
  const hook = renderHook(() => useEmployees(id, id, other, undefined, '2'), { wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(api.GET).toHaveBeenCalledWith(
    '/v1/businesses/{businessId}/employees',
    expect.objectContaining({
      params: {
        header: { 'x-company-id': id },
        path: { businessId: id },
        query: { limit: 20, q: '2' },
      },
    }),
  );
  expect(
    client
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey),
  ).toContainEqual(['employees', id, id, other, 'list', undefined, '2']);
  api.GET.mockClear();
  const empty = renderHook(() => useEmployees(id, other, other, undefined, ''), { wrapper });
  await waitFor(() => expect(empty.result.current.isSuccess).toBe(true));
  expect(api.GET).toHaveBeenCalledWith(
    '/v1/businesses/{businessId}/employees',
    expect.objectContaining({
      params: {
        header: { 'x-company-id': id },
        path: { businessId: other },
        query: { limit: 20 },
      },
    }),
  );
});
it('does not show the previous rows while the next q is pending', async () => {
  const listed = {
    id,
    name_en: 'Synthetic',
    name_ar: null,
    role_code: 'staff' as const,
    primary_branch_id: id,
    hire_date: '2026-01-01',
    employee_number: 15,
  };
  let hold = false;
  let resolveNext: (value: { data: { items: []; next_cursor: null } }) => void = () => undefined;
  api.GET.mockImplementation(
    () =>
      new Promise((resolve) => {
        if (hold) resolveNext = resolve;
        else resolve({ data: { items: [listed], next_cursor: null } });
      }),
  );
  const { wrapper } = setup();
  const hook = renderHook(({ q }: { q?: string }) => useEmployees(id, id, other, undefined, q), {
    wrapper,
    initialProps: {},
  });
  await waitFor(() => expect(hook.result.current.data?.items[0]?.name_en).toBe('Synthetic'));
  hold = true;
  hook.rerender({ q: 'Sara' });
  await waitFor(() => expect(hook.result.current.isPending).toBe(true));
  expect(hook.result.current.data).toBeUndefined();
  resolveNext({ data: { items: [], next_cursor: null } });
  await waitFor(() => expect(hook.result.current.data?.items).toEqual([]));
});
it('sends the expected revision through generated PATCH and updates only the original detail cache', async () => {
  api.GET.mockResolvedValue({ data: record });
  api.PATCH.mockResolvedValueOnce({ data: { ...record, revision: 4, name_en: 'Changed' } });
  const { wrapper, client } = setup();
  const hook = renderHook(() => useEmployeeEdit(id, id, other, id), { wrapper });
  await waitFor(() => expect(hook.result.current.record.isSuccess).toBe(true));
  await act(async () => {
    await hook.result.current.save.mutateAsync(terms);
  });
  expect(api.PATCH).toHaveBeenCalledWith('/v1/businesses/{businessId}/employees/{employeeId}', {
    params: { header: { 'x-company-id': id }, path: { businessId: id, employeeId: id } },
    body: { ...terms, name_ar: null, contract_end: null, user_id: null },
  });
  expect(client.getQueryData(['employees', id, id, other, 'detail', id])).toMatchObject({
    revision: 4,
    name_en: 'Changed',
  });
});
it('invalidates edit capability after save and create capability when the primary branch changes', async () => {
  api.GET.mockResolvedValue({ data: record });
  api.PATCH.mockResolvedValueOnce({ data: { ...record, revision: 4, primary_branch_id: other } });
  const { wrapper, client } = setup();
  const editKey = ['employee-number-edit-capability', id, other, id, id];
  const typeKey = ['employee-number-capability', id, id, other, id];
  client.setQueryData(editKey, { can_edit_number: true });
  client.setQueryData(typeKey, { can_type_number: true });
  const hook = renderHook(() => useEmployeeEdit(id, id, other, id), { wrapper });
  await waitFor(() => expect(hook.result.current.record.isSuccess).toBe(true));
  await act(async () => {
    await hook.result.current.save.mutateAsync({ ...terms, primary_branch_id: other });
  });
  expect(client.getQueryState(editKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(typeKey)?.isInvalidated).toBe(true);
});
it('keeps create capability when an edit changes attachments only', async () => {
  api.GET.mockResolvedValue({ data: record });
  api.PATCH.mockResolvedValueOnce({ data: { ...record, revision: 4, branch_ids: [id, other] } });
  const { wrapper, client } = setup();
  const editKey = ['employee-number-edit-capability', id, other, id, id];
  const typeKey = ['employee-number-capability', id, id, other, id];
  client.setQueryData(editKey, { can_edit_number: true });
  client.setQueryData(typeKey, { can_type_number: true });
  const hook = renderHook(() => useEmployeeEdit(id, id, other, id), { wrapper });
  await waitFor(() => expect(hook.result.current.record.isSuccess).toBe(true));
  await act(async () => {
    await hook.result.current.save.mutateAsync({ ...terms, branch_ids: [id, other] });
  });
  expect(client.getQueryState(editKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(typeKey)?.isInvalidated).toBe(false);
});
it('invalidates the capability of the employee whose save started, after the hook moved to another', async () => {
  const third = '01920000-0000-7000-8000-0000000000a4';
  api.GET.mockResolvedValue({ data: record });
  let finish: (value: unknown) => void = () => undefined;
  api.PATCH.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
  const { wrapper, client } = setup();
  const firstKey = ['employee-number-edit-capability', id, other, id, id];
  const secondKey = ['employee-number-edit-capability', id, other, id, third];
  client.setQueryData(firstKey, { can_edit_number: true });
  client.setQueryData(secondKey, { can_edit_number: true });
  const hook = renderHook(({ employee }) => useEmployeeEdit(id, id, other, employee), {
    wrapper,
    initialProps: { employee: id },
  });
  await waitFor(() => expect(hook.result.current.record.isSuccess).toBe(true));
  let pending: Promise<unknown> = Promise.resolve();
  act(() => {
    pending = hook.result.current.save.mutateAsync({ ...terms, branch_ids: [id, other] });
  });
  hook.rerender({ employee: third });
  await act(async () => {
    finish({ data: { ...record, revision: 4, branch_ids: [id, other] } });
    await pending;
  });
  expect(client.getQueryState(firstKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(secondKey)?.isInvalidated).toBe(false);
});
it('preserves conflict errors and the old edit token without an automatic retry/refetch', async () => {
  const conflict = {
    code: 'EMPLOYEE_REVISION_CONFLICT',
    message_ar: t('ar', 'staff.invalid'),
    message_en: 'Synthetic conflict',
  };
  api.GET.mockResolvedValue({ data: record });
  api.PATCH.mockClear().mockResolvedValueOnce({ error: conflict });
  const { wrapper } = setup();
  const hook = renderHook(() => useEmployeeEdit(id, id, other, id), { wrapper });
  await waitFor(() => expect(hook.result.current.record.isSuccess).toBe(true));
  await act(async () => {
    await expect(hook.result.current.save.mutateAsync(terms)).rejects.toEqual(conflict);
  });
  expect(api.PATCH).toHaveBeenCalledTimes(1);
  expect(hook.result.current.record.data?.revision).toBe(3);
});
