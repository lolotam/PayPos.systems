import type { ReactNode } from 'react';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useSetEmployeeNumber } from './use-set-employee-number';

const put = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ PUT: put }) }));
const id = '01920000-0000-7000-8000-0000000000a2';

function renderNumber(client: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSetEmployeeNumber(id, id, id, id), { wrapper });
}

it('drops inactive attendance and performer caches after a saved number', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const performers = ['session-performers', id, 'inactive'];
  const facts = ['session-performer-facts', id, 'inactive'];
  const attendance = ['attendance-actions', id, id, id, id, 'employees', '', undefined];
  client.setQueryData(performers, { items: [{ id, employee_number: 4 }] });
  client.setQueryData(facts, { items: [{ id, employee_number: 4 }] });
  client.setQueryData(attendance, { pages: [{ items: [{ employee_number: 4 }] }] });
  const active = ['session-performers', id, 'active'];
  client.setQueryData(active, { items: [{ id, employee_number: 4 }] });
  function Watch() {
    useQuery({ queryKey: active, queryFn: () => new Promise(() => undefined) });
    return null;
  }
  put.mockResolvedValue({ data: { employee_id: id, employee_number: 7 } });
  const hook = renderNumber(client);
  const view = renderHook(() => null, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <Watch />
        {children}
      </QueryClientProvider>
    ),
  });
  await act(async () => {
    await hook.result.current.mutateAsync(7);
  });
  expect(client.getQueryData(performers)).toBeUndefined();
  expect(client.getQueryData(facts)).toBeUndefined();
  expect(client.getQueryData(attendance)).toBeUndefined();
  expect(client.getQueryState(active)?.isInvalidated).toBe(true);
  view.unmount();
});

it('invalidates number capability after a forbidden edit', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const capability = ['employee-number-capability', id, id, id];
  client.setQueryData(capability, { can_type_number: true });
  const refusal = {
    code: 'FORBIDDEN',
    message_en: 'Synthetic refusal',
    message_ar: t('ar', 'errors.FORBIDDEN'),
  };
  put.mockResolvedValueOnce({ error: refusal });
  const hook = renderNumber(client);
  await act(async () => {
    await expect(hook.result.current.mutateAsync(7)).rejects.toEqual(refusal);
  });
  expect(client.getQueryState(capability)?.isInvalidated).toBe(true);
});
