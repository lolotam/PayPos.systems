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
