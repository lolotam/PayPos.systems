import type { ReactNode } from 'react';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useCreateEmployee } from './use-create-employee';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ POST: post }) }));
const id = '01920000-0000-7000-8000-0000000000a2';
const input = {
  primary_branch_id: id,
  name_en: 'Synthetic employee',
  role_code: 'staff' as const,
  hire_date: '2026-01-01',
};
const record = {
  ...input,
  id,
  business_id: id,
  name_ar: null,
  contract_end: null,
  user_id: null,
  created_at: '2026-10-03T00:00:00Z',
  employee_number: null,
};
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  );
}
it('sends selected company/business through the generated client and normalizes optional fields', async () => {
  post.mockResolvedValueOnce({ data: record });
  const hook = renderHook(() => useCreateEmployee(id, id, id), { wrapper });
  await act(async () => {
    expect(await hook.result.current.mutateAsync(input)).toEqual(record);
  });
  expect(post).toHaveBeenCalledWith('/v1/businesses/{businessId}/employees', {
    params: { header: { 'x-company-id': id }, path: { businessId: id } },
    body: { ...input, name_ar: null, contract_end: null, user_id: null },
  });
});
it('posts employee_number when the create includes one', async () => {
  post.mockResolvedValueOnce({ data: { ...record, employee_number: 7 } });
  const hook = renderHook(() => useCreateEmployee(id, id, id), { wrapper });
  await act(async () => {
    await hook.result.current.mutateAsync({ ...input, employee_number: 7 });
  });
  expect(post).toHaveBeenCalledWith('/v1/businesses/{businessId}/employees', {
    params: { header: { 'x-company-id': id }, path: { businessId: id } },
    body: { ...input, name_ar: null, contract_end: null, user_id: null, employee_number: 7 },
  });
});
it('invalidates numbering after a create and capability only after a sent-number refusal', async () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData(['employee-numbering', id], { next_number: 4 });
  client.setQueryData(['employee-number-capability', id, id, id], { can_type_number: true });
  post.mockResolvedValueOnce({ data: record });
  const hook = renderHook(() => useCreateEmployee(id, id, id), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await act(async () => {
    await hook.result.current.mutateAsync(input);
  });
  expect(client.getQueryState(['employee-numbering', id])?.isInvalidated).toBe(true);
  expect(client.getQueryState(['employee-number-capability', id, id, id])?.isInvalidated).toBe(
    false,
  );
  const refusal = {
    code: 'FORBIDDEN',
    message_ar: t('ar', 'errors.FORBIDDEN'),
    message_en: 'Synthetic refusal',
  };
  post.mockResolvedValueOnce({ error: refusal });
  await act(async () => {
    await expect(hook.result.current.mutateAsync(input)).rejects.toEqual(refusal);
  });
  expect(client.getQueryState(['employee-number-capability', id, id, id])?.isInvalidated).toBe(
    false,
  );
  post.mockResolvedValueOnce({ error: refusal });
  await act(async () => {
    await expect(hook.result.current.mutateAsync({ ...input, employee_number: 7 })).rejects.toEqual(
      refusal,
    );
  });
  expect(client.getQueryState(['employee-number-capability', id, id, id])?.isInvalidated).toBe(
    true,
  );
});
it('preserves the bilingual server refusal without automatically retrying a create', async () => {
  const error = {
    code: 'FORBIDDEN',
    message_ar: t('ar', 'errors.FORBIDDEN'),
    message_en: 'Synthetic refusal',
  };
  post.mockResolvedValueOnce({ error });
  const hook = renderHook(() => useCreateEmployee(id, id, id), { wrapper });
  await act(async () => {
    await expect(hook.result.current.mutateAsync(input)).rejects.toEqual(error);
  });
});
