import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useSetCompanyEmployeeNumber } from './use-company-employee-numbers';

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
const company = '01920000-0000-7000-8000-0000000000c1';
const user = '01920000-0000-7000-8000-0000000000c2';
const business = '01920000-0000-7000-8000-0000000000c3';
const employee = '01920000-0000-7000-8000-0000000000c4';
const row = {
  employee_id: employee,
  name_ar: null,
  name_en: 'Synthetic employee',
  business_id: business,
  business_name_ar: null,
  business_name_en: 'Synthetic salon',
  employee_number: 4,
};
const page = { items: [row], next_cursor: null };

it('updates every cached page by its own search, dropping a row a digit search no longer matches', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const all = ['employee-numbers', company, user, 'list', null, null];
  const byNumber = ['employee-numbers', company, user, 'list', null, '4'];
  const byName = ['employee-numbers', company, user, 'list', null, 'Synthetic'];
  client.setQueryData(byName, page);
  client.setQueryData(all, page);
  client.setQueryData(byNumber, page);
  api.PUT.mockResolvedValue({
    data: { employee_id: employee, employee_number: 7 },
    response: { status: 200 },
  });
  api.GET.mockReturnValue(new Promise(() => undefined));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useSetCompanyEmployeeNumber(company, user), { wrapper });
  await act(async () => {
    await hook.result.current.mutateAsync({
      businessId: business,
      employeeId: employee,
      employeeNumber: 7,
    });
  });
  expect(client.getQueryData<typeof page>(all)?.items[0]?.employee_number).toBe(7);
  expect(client.getQueryData<typeof page>(byNumber)?.items).toEqual([]);
  expect(client.getQueryData<typeof page>(byName)?.items[0]?.employee_number).toBe(7);
  expect(client.getQueryState(byNumber)?.isInvalidated).toBe(true);
});
