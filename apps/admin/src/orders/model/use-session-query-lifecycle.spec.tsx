import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { id, scope } from './session-recording-result.fixture';
import { useSessionQueryLifecycle } from './use-session-query-lifecycle';

const visit = { customer_name: 'Synthetic customer', customer_phone_masked: '***001' };
function recordingsKey(current: typeof scope) {
  return ['own-recordings', current.companyId, current.businessId, current.branchId, current.userId, 'record-service-session', 1, 1] as const;
}

it('drops cached own recordings on a scope change and on unmount, and keeps the other scope until then', () => {
  const client = new QueryClient();
  const other = { ...scope, companyId: id(90) };
  const ownKey = recordingsKey(scope);
  const otherKey = recordingsKey(other);
  client.setQueryData(ownKey, visit);
  client.setQueryData(otherKey, visit);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(({ value }) => useSessionQueryLifecycle(value, true), { wrapper, initialProps: { value: scope } });
  hook.rerender({ value: other });
  expect(client.getQueryData(ownKey)).toBeUndefined();
  expect(client.getQueryData(otherKey)).toEqual(visit);
  hook.unmount();
  expect(client.getQueryData(otherKey)).toBeUndefined();
});

it('drops the cached day list and line history when the operator or scope changes', () => {
  const client = new QueryClient();
  const other = { ...scope, userId: id(91) };
  const parts = (current: typeof scope) => [current.companyId, current.businessId, current.branchId, current.userId] as const;
  const dayKey = ['branch-day-sessions', ...parts(scope), '2026-10-14', false] as const;
  const historyKey = ['service-line-edits', ...parts(scope), id(7), id(8)] as const;
  const otherDayKey = ['branch-day-sessions', ...parts(other), '2026-10-14', false] as const;
  client.setQueryData(dayKey, visit);
  client.setQueryData(historyKey, visit);
  client.setQueryData(otherDayKey, visit);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(({ value }) => useSessionQueryLifecycle(value, true), { wrapper, initialProps: { value: scope } });
  hook.rerender({ value: other });
  expect(client.getQueryData(dayKey)).toBeUndefined();
  expect(client.getQueryData(historyKey)).toBeUndefined();
  expect(client.getQueryData(otherDayKey)).toEqual(visit);
  hook.unmount();
  expect(client.getQueryData(otherDayKey)).toBeUndefined();
});

it('drops cached session tips when the operator or scope changes', () => {
  const client = new QueryClient();
  const other = { ...scope, userId: id(91) };
  const parts = (current: typeof scope) =>
    [current.companyId, current.businessId, current.branchId, current.userId] as const;
  const tipsKey = ['session-tips', ...parts(scope), id(12)] as const;
  const otherKey = ['session-tips', ...parts(other), id(12)] as const;
  client.setQueryData(tipsKey, { revision: 0 });
  client.setQueryData(otherKey, { revision: 0 });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(({ value }) => useSessionQueryLifecycle(value, true), {
    wrapper,
    initialProps: { value: scope },
  });
  hook.rerender({ value: other });
  expect(client.getQueryData(tipsKey)).toBeUndefined();
  expect(client.getQueryData(otherKey)).toEqual({ revision: 0 });
  hook.unmount();
  expect(client.getQueryData(otherKey)).toBeUndefined();
});
