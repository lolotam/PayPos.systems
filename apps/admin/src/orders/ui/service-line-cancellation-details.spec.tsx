import type { ReactNode } from 'react';
import type { ServiceSessionDayPage as DayPage } from '@pospay/contracts';
import { formatInstant, t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { id, instant, scope } from '../model/session-recording-result.fixture';
import { ServiceSessionDayPage } from '../pages/service-session-day-page';

const state = vi.hoisted(() => ({ get: vi.fn(), online: true as boolean | null }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));
vi.mock('../model/use-browser-connectivity', () => ({
  useBrowserConnectivity: () => state.online,
}));

type Line = DayPage['items'][number]['lines'][number];
const cancelledAt = '2026-10-14T08:00:06.000Z';
const performer = {
  employee_id: id(6),
  name_en: 'Nada',
  name_ar: null,
  share_bps: 10000,
  not_clocked_in_warning: false,
  approved_leave_warning: false,
};
const line: Line = {
  id: id(22),
  service_id: id(5),
  ordinal: 1,
  name_en: 'Service 22',
  name_ar: null,
  status: 'CANCELLED',
  revision: 4,
  edited: false,
  late: false,
  list_price: '10.000',
  price: '10.000',
  discount: '1.000',
  net: '9.000',
  effective_discount_bps: 1000,
  recorded_by: id(4),
  recorded_at: instant,
  has_performer_warning: false,
  performers: [performer],
};
const day = {
  data: {
    items: [
      {
        id: id(12),
        business_id: scope.businessId,
        branch_id: scope.branchId,
        customer: { id: id(7), name: 'Synthetic customer' },
        occurred_at: instant,
        recorded_at: instant,
        business_date: '2026-10-13',
        business_timezone: 'Asia/Kuwait',
        recorded_by: scope.userId,
        late: false,
        lines: [line],
      },
    ],
    next_cursor: null,
  },
  response: { status: 200 },
};
const cancellation = {
  data: {
    cancelled_at: cancelledAt,
    canceller_label_ar: 'Label AR',
    canceller_label_en: 'Nada Branch',
    reason: 'Customer left',
    previous: { revision: 2, price: '8.500', discount: '1.250', net: '7.250' },
  },
  response: { status: 200 },
};
const refused = {
  error: { code: 'FORBIDDEN', message_ar: 'Denied AR', message_en: 'Denied EN' },
  response: { status: 403 },
};

function answer(read: typeof cancellation | typeof refused) {
  state.get.mockImplementation((path: string) => {
    const target = String(path);
    if (target.includes('/capabilities')) {
      return Promise.resolve({ data: { can_cancel_lines: false }, response: { status: 200 } });
    }
    if (target.includes('/cancellation')) return Promise.resolve(read);
    return Promise.resolve(day);
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<ServiceSessionDayPage scope={scope} timezone="Asia/Kuwait" />, { wrapper });
}

async function openDetails() {
  state.online = true;
  renderPage();
  expect(await screen.findByText('Synthetic customer')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineCancel.details') }));
}

it('shows the canceller, reason, and previous amounts after the details toggle', async () => {
  answer(cancellation);
  await openDetails();
  expect(await screen.findByText('Customer left', { exact: false })).toBeTruthy();
  expect(screen.getByText('Nada Branch', { exact: false })).toBeTruthy();
  expect(screen.getByText('8.500')).toBeTruthy();
  expect(screen.getByText('1.250')).toBeTruthy();
  expect(screen.getByText('7.250')).toBeTruthy();
  expect(screen.getByText(formatInstant(new Date(cancelledAt), 'en', 'Asia/Kuwait'))).toBeTruthy();
  expect(screen.getByText('Service 22')).toBeTruthy();
});

it('clears the day view when the cancellation read is forbidden', async () => {
  answer(refused);
  await openDetails();
  await waitFor(() => {
    expect(screen.getByRole('alert').textContent).toContain('Denied EN');
    expect(screen.queryByText('Synthetic customer')).toBeNull();
  });
  expect(screen.queryByText('Service 22')).toBeNull();
  expect(screen.queryByText('Nada')).toBeNull();
  expect(screen.queryByText('10.000')).toBeNull();
  expect(screen.queryByText('1.000')).toBeNull();
  expect(screen.queryByText('9.000')).toBeNull();
  expect(screen.getByRole('button', { name: t('en', 'serviceLineEdit.retry') })).toBeTruthy();
  expect(screen.getByLabelText(t('en', 'serviceLineEdit.date'))).toBeTruthy();
});
