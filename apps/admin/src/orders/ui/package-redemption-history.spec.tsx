import type { CustomerPackageDetail, CustomerPackageExtension, CustomerPackageRedemption } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { PackageRedemptionHistory } from './package-redemption-history';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const scope = { companyId: 'company', businessId: 'business', branchId: 'branch', userId: 'actor' };
const customerId = '01920000-0000-7000-8000-000000000005';
const entitlementId = '01920000-0000-7000-8000-000000000006';
const componentId = '01920000-0000-7000-8000-000000000020';

function detail(
  redemptions: CustomerPackageRedemption[],
  extensions: CustomerPackageExtension[] = [],
): CustomerPackageDetail {
  return {
    id: entitlementId,
    customer_id: customerId,
    package_type_id: null,
    provenance: 'IMPORTED',
    name_en: 'Synthetic package',
    name_ar: null,
    validity_days: null,
    list_price: null,
    price_paid: '30.000',
    discount: null,
    discount_bps: null,
    paid_method: null,
    seller_employee_id: null,
    seller_linked_user_id: null,
    sold_branch_id: null,
    sold_at: null,
    sold_business_date: null,
    expires_on: '2026-12-31',
    refunded_amount: '0.000',
    revision: 1,
    components: [{
      id: componentId,
      service_id: '01920000-0000-7000-8000-000000000030',
      position: 1,
      name_en: 'Synthetic service',
      name_ar: null,
      list_price_snapshot: '10.000',
      component_value: '30.000',
      sessions_total: 3,
      remaining: 1,
      used: 2,
      refunded: 0,
      slots: [{ ordinal: 1, state: 'USED', unit_value: '10.000' }],
    }],
    redemptions,
    extensions,
  };
}

function redemption(id: string, ordinal: number, reversedAt: string | null): CustomerPackageRedemption {
  return {
    id,
    component_id: componentId,
    ordinal,
    redeemed_at: '2026-10-20T10:00:00.000Z',
    visit_business_date: ordinal === 2 ? '2026-10-19' : '2026-10-18',
    reversed_at: reversedAt,
  };
}

function renderHistory(canExtend = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>
    <PackageRedemptionHistory
      scope={scope}
      customerId={customerId}
      entitlementId={entitlementId}
      canExtend={canExtend}
    />
  </QueryClientProvider>);
}

function openHistory() {
  fireEvent.click(screen.getByText(t('en', 'serviceSessions.packageHistory')));
}

beforeEach(() => {
  get.mockReset();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

it('fetches only after opening and shows session, service, visit date and reversed badge', async () => {
  get.mockResolvedValueOnce({
    data: detail([
      redemption('01920000-0000-7000-8000-000000000041', 2, '2026-10-21T10:00:00.000Z'),
      redemption('01920000-0000-7000-8000-000000000042', 1, null),
    ]),
    response: { status: 200 },
  });
  renderHistory();
  expect(get).not.toHaveBeenCalled();
  openHistory();
  expect(await screen.findByText('Session 2 Synthetic service')).toBeTruthy();
  expect(screen.getByText('Session 1 Synthetic service')).toBeTruthy();
  expect(screen.getByText('2026-10-19')).toBeTruthy();
  expect(screen.getByText('2026-10-18')).toBeTruthy();
  expect(screen.getByText(t('en', 'serviceSessions.packageHistoryReversed'))).toBeTruthy();
  expect(get).toHaveBeenCalledTimes(1);
});

it('shows the empty history message inside the opened section', async () => {
  get.mockResolvedValueOnce({ data: detail([]), response: { status: 200 } });
  renderHistory();
  openHistory();
  expect((await screen.findByText(t('en', 'serviceSessions.packageHistoryEmpty'))).getAttribute('role')).toBe('status');
});

it('keeps the history error inside its collapsible section', async () => {
  get.mockResolvedValueOnce({
    error: { code: 'INTERNAL', message_ar: 'Synthetic AR', message_en: 'Synthetic EN' },
    response: { status: 500 },
  });
  renderHistory();
  openHistory();
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toBe(t('en', 'serviceSessions.packageHistoryLoadFailed'));
  const section = screen.getByText(t('en', 'serviceSessions.packageHistory')).closest('details');
  if (!section) throw new Error('Missing history section');
  expect(within(section).getByRole('alert')).toBe(alert);
});

const extension: CustomerPackageExtension = {
  id: '01920000-0000-7000-8000-000000000050',
  previous_expires_on: '2026-12-31',
  new_expires_on: '2027-01-31',
  extended_at: '2027-01-01T08:00:00.000Z',
};

it('shows extensions with empty redemptions and hides the extend button by default', async () => {
  get.mockResolvedValue({ data: detail([], [extension]), response: { status: 200 } });
  renderHistory();
  openHistory();
  expect(await screen.findByText(t('en', 'packageExtension.historyTitle'))).toBeTruthy();
  expect(screen.getByText('2027-01-31')).toBeTruthy();
  expect(screen.getByText(t('en', 'serviceSessions.packageHistoryEmpty'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: t('en', 'packageExtension.extend') })).toBeNull();
});

it('opens the extend dialog when canExtend is true', async () => {
  get.mockResolvedValue({ data: detail([], [extension]), response: { status: 200 } });
  renderHistory(true);
  openHistory();
  const button = await screen.findByRole('button', { name: t('en', 'packageExtension.extend') });
  fireEvent.click(button);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('heading', { name: t('en', 'packageExtension.dialogTitle') }))
    .toBeTruthy();
  expect(within(dialog).getByLabelText(t('en', 'packageExtension.newDate'))).toBeTruthy();
});
