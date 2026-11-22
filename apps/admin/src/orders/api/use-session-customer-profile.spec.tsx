import type { ReactNode } from 'react';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { useSessionCustomerProfile } from './use-session-customer-profile';

const state = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get }) }));

const customerId = '01920000-0000-7000-8000-0000000000b1';
const profile = {
  id: customerId,
  name: 'Synthetic profile',
  locale: 'ar',
  opted_out: false,
  phone: '***123',
  birthday: { day: 29, month: 2, year: null },
  gender: 'female',
  email: 'a@b.test',
  notes: [
    {
      business_id: '01920000-0000-7000-8000-0000000000b2',
      business_name_ar: t('ar', 'serviceSessions.note'),
      business_name_en: 'English business',
      note: 'First synthetic note',
      created_at: '2026-11-01T10:00:00.000Z',
    },
  ],
};
const client = new QueryClient({ defaultOptions: { queries: { retry: 3 } } });
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const entry = {
  companyId: 'company',
  branchId: 'branch',
  businessId: 'business',
  userId: 'actor',
  entryScope: 'branch' as const,
  customerId,
};

it.each([
  ['company', '/v1/customers/{customerId}/profile', { customerId }],
  ['business', '/v1/businesses/{businessId}/customers/{customerId}/profile', { businessId: 'business', customerId }],
  ['branch', '/v1/branches/{branchId}/customers/{customerId}/profile', { branchId: 'branch', customerId }],
] as const)('reads the %s profile route with the company header and parses the response', async (entryScope, path, pathParams) => {
  state.get.mockClear();
  state.get.mockResolvedValueOnce({ data: profile, response: { status: 200 } });
  const hook = renderHook(
    () => useSessionCustomerProfile({ ...entry, entryScope }),
    { wrapper },
  );
  await waitFor(() => expect(hook.result.current.data).toEqual(profile));
  expect(state.get).toHaveBeenCalledWith(
    path,
    expect.objectContaining({
      params: { header: { 'x-company-id': 'company' }, path: pathParams },
      cache: 'no-store',
    }),
  );
});

it('does not fetch without a selection and does not retry a refused read', async () => {
  state.get.mockClear();
  const empty = renderHook(
    () => useSessionCustomerProfile({ ...entry, customerId: null }),
    { wrapper },
  );
  await act(async () => undefined);
  expect(state.get).not.toHaveBeenCalled();
  expect(empty.result.current.fetchStatus).toBe('idle');

  state.get.mockResolvedValueOnce({
    error: { code: 'NOT_FOUND', message_ar: 'AR', message_en: 'EN' },
    response: { status: 404 },
  });
  const refused = renderHook(() => useSessionCustomerProfile(entry), { wrapper });
  await waitFor(() => expect(refused.result.current.isError).toBe(true));
  expect(state.get).toHaveBeenCalledTimes(1);
});

it('does not issue a profile GET while reads are gated offline', async () => {
  state.get.mockClear();
  const hook = renderHook(() => useSessionCustomerProfile(entry, false), { wrapper });
  await act(async () => undefined);
  expect(state.get).not.toHaveBeenCalled();
  expect(hook.result.current.fetchStatus).toBe('idle');
  state.get.mockResolvedValueOnce({ data: profile, response: { status: 200 } });
  const allowed = renderHook(() => useSessionCustomerProfile(entry, true), { wrapper });
  await waitFor(() => expect(allowed.result.current.data).toEqual(profile));
  expect(state.get).toHaveBeenCalledTimes(1);
});

it('keys a read by the selected customer so a switch cannot reuse an earlier profile', async () => {
  state.get.mockClear();
  let finish!: (value: unknown) => void;
  state.get.mockImplementationOnce(
    () => new Promise((done) => { finish = done; }),
  );
  const hook = renderHook(() => useSessionCustomerProfile(entry), { wrapper });
  await waitFor(() => expect(finish).toBeDefined());
  const next = '01920000-0000-7000-8000-0000000000b3';
  state.get.mockResolvedValueOnce({ data: { ...profile, id: next, name: 'Second profile' }, response: { status: 200 } });
  const switched = renderHook(
    () => useSessionCustomerProfile({ ...entry, customerId: next }),
    { wrapper },
  );
  await act(async () => finish({ data: profile, response: { status: 200 } }));
  await waitFor(() => expect(switched.result.current.data?.name).toBe('Second profile'));
  expect(hook.result.current.data?.name).toBe('Synthetic profile');
});
