import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { SessionCustomerProfileCard } from './session-customer-profile-card';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: get }) }));

const id = '01920000-0000-7000-8000-0000000000b1';
const entry = {
  customerId: id,
  companyId: 'company',
  branchId: 'branch',
  businessId: 'business',
  userId: 'actor',
  entryScope: 'branch' as const,
};
const profile = {
  id,
  name: 'Private customer',
  locale: 'ar',
  opted_out: false,
  phone: '***123',
  birthday: null,
  gender: null,
  email: 'private@example.test',
  notes: [],
};
let online = true;
beforeEach(() => {
  online = true;
  get.mockReset();
  get.mockResolvedValue({ data: profile, response: { status: 200 } });
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
});

function card(value: boolean) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionCustomerProfileCard {...entry} locale="en" online={value} />
    </QueryClientProvider>
  );
}
function mount() {
  return render(card(online));
}

it('keeps an offline card blocked until Retry, then issues one scoped GET and shows the profile', async () => {
  online = false;
  const view = mount();
  expect(screen.getByText(t('en', 'serviceSessions.profileOffline'))).toBeTruthy();
  expect((screen.getByRole('button', { name: t('en', 'serviceSessions.profileRetry') }) as HTMLButtonElement).disabled).toBe(true);
  expect(get).not.toHaveBeenCalled();

  online = true;
  view.rerender(card(true));
  await waitFor(() => expect((screen.getByRole('button', { name: t('en', 'serviceSessions.profileRetry') }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByText(t('en', 'serviceSessions.profileOffline'))).toBeTruthy();
  expect(get).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.profileRetry') }));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  expect(get).toHaveBeenCalledWith(
    '/v1/branches/{branchId}/customers/{customerId}/profile',
    expect.objectContaining({
      params: { header: { 'x-company-id': 'company' }, path: { branchId: 'branch', customerId: id } },
      cache: 'no-store',
    }),
  );
  expect(await screen.findByText('private@example.test')).toBeTruthy();
});

it('does not send a GET from an initial stale online render while the browser is offline', async () => {
  online = false;
  render(card(true));
  expect(await screen.findByText(t('en', 'serviceSessions.profileLoadFailed'))).toBeTruthy();
  expect(screen.getByRole('button', { name: t('en', 'serviceSessions.profileRetry') })).toBeTruthy();
  expect(get).not.toHaveBeenCalled();
});

it('does not send a GET when browser connectivity drops before the UI snapshot updates', async () => {
  online = false;
  const view = mount();
  online = true;
  view.rerender(card(true));
  const retry = await screen.findByRole('button', { name: t('en', 'serviceSessions.profileRetry') }) as HTMLButtonElement;
  await waitFor(() => expect(retry.disabled).toBe(false));
  expect(get).not.toHaveBeenCalled();

  // المتصفح ينقطع قبل ما الرندر الجديد يوصل للبطاقة، والزرار لسه متاح من اللقطة القديمة.
  online = false;
  fireEvent.click(retry);
  expect(screen.getByText(t('en', 'serviceSessions.profileOffline'))).toBeTruthy();
  expect(screen.getByRole('button', { name: t('en', 'serviceSessions.profileRetry') })).toBeTruthy();
  expect(get).not.toHaveBeenCalled();
});
