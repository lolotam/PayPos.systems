import type { ReactNode } from 'react';
import type { ServiceSessionDayPage as DayPage } from '@pospay/contracts';
import { formatInstant, t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { id, instant, savedLine, scope } from '../model/session-recording-result.fixture';
import { ServiceSessionDayPage } from './service-session-day-page';

const state = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  online: true as boolean | null,
  locale: 'en' as 'ar' | 'en',
}));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get, POST: state.post }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('../model/use-browser-connectivity', () => ({
  useBrowserConnectivity: () => state.online,
}));
type Line = DayPage['items'][number]['lines'][number];
const keptAt = '2026-10-14T08:00:06.000Z';
const postedAt = '2026-10-15T11:00:00.000Z';
const performer = {
  employee_id: id(6),
  name_en: 'Nada',
  name_ar: null,
  share_bps: 10000,
  not_clocked_in_warning: false,
  approved_leave_warning: false,
};
function line(n: number, status: Line['status'], revision: number, edited: boolean): Line {
  return {
    id: id(n),
    service_id: id(5),
    ordinal: 1,
    name_en: `Service ${n}`,
    name_ar: null,
    status,
    revision,
    edited,
    late: false,
    list_price: '10.000',
    price: '10.000',
    discount: '1.000',
    net: '9.000',
    effective_discount_bps: 1000,
    recorded_by: id(4),
    recorded_at: instant,
    has_performer_warning: false,
    performers: [{ ...performer, name_en: `Nada ${n}` }],
    ...(status === 'CANCELLED' ? { cancelled_at: keptAt } : {}),
  };
}
const visit = {
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
  lines: [
    line(20, 'ACTIVE', 3, false),
    line(21, 'ACTIVE', 2, true),
    line(22, 'CANCELLED', 1, false),
  ],
};
const day = { data: { items: [visit], next_cursor: null }, response: { status: 200 } };
function renderPage(canCancel?: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(
    <ServiceSessionDayPage
      scope={scope}
      timezone="Asia/Kuwait"
      {...(canCancel === undefined ? {} : { canCancel })}
    />,
    { wrapper },
  );
}
const cancelButton = (locale: 'ar' | 'en') =>
  screen.getAllByRole('button', { name: t(locale, 'serviceLineCancel.cancel') });
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  state.online = true;
  state.locale = 'en';
  state.get.mockReset();
  state.post.mockReset();
  state.get.mockResolvedValue(day);
});

function clickCancel() {
  const button = cancelButton('en')[0];
  if (!button) throw new Error('missing cancel button');
  fireEvent.click(button);
}

it('shows Cancel only when allowed, and the mark with its business-zone date to every caller', async () => {
  const view = renderPage();
  expect(await screen.findByText('Synthetic customer')).toBeTruthy();
  expect(cancelButton('en')).toHaveLength(2);
  expect(screen.getAllByText(t('en', 'serviceLineCancel.cancelled'))).toHaveLength(1);
  expect(screen.getByText(formatInstant(new Date(keptAt), 'en', 'Asia/Kuwait'))).toBeTruthy();
  view.unmount();
  const hidden = renderPage(false);
  expect(await screen.findByText('Synthetic customer')).toBeTruthy();
  expect(
    screen.queryAllByRole('button', { name: t('en', 'serviceLineCancel.cancel') }),
  ).toHaveLength(0);
  expect(screen.getByText(t('en', 'serviceLineCancel.cancelled'))).toBeTruthy();
  hidden.unmount();
  state.locale = 'ar';
  renderPage(false);
  expect(await screen.findByText(t('ar', 'serviceLineCancel.cancelled'))).toBeTruthy();
  expect(
    screen.queryAllByRole('button', { name: t('ar', 'serviceLineCancel.cancel') }),
  ).toHaveLength(0);
});

it('marks the line cancelled with the business-zone date after a successful cancel', async () => {
  let posted = false;
  const cancelledVisit = {
    ...visit,
    lines: visit.lines.map((item) =>
      item.id === id(20)
        ? { ...item, status: 'CANCELLED' as const, cancelled_at: postedAt, revision: 4 }
        : item,
    ),
  };
  state.get.mockImplementation(() =>
    Promise.resolve(
      posted
        ? { data: { items: [cancelledVisit], next_cursor: null }, response: { status: 200 } }
        : day,
    ),
  );
  state.post.mockImplementation(() => {
    posted = true;
    return Promise.resolve({
      data: {
        line: {
          ...savedLine,
          id: id(20),
          session_id: id(12),
          status: 'CANCELLED',
          cancelled_at: postedAt,
          revision: 4,
        },
        session: { id: id(12), total_net: '6.412' },
      },
      response: { status: 200 },
    });
  });
  renderPage();
  await screen.findByText('Synthetic customer');
  clickCancel();
  fireEvent.change(screen.getByLabelText(t('en', 'serviceLineCancel.reason')), {
    target: { value: 'because' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineCancel.submit') }));
  await waitFor(() =>
    expect(screen.getAllByText(t('en', 'serviceLineCancel.cancelled'))).toHaveLength(2),
  );
  expect(screen.getByText(formatInstant(new Date(postedAt), 'en', 'Asia/Kuwait'))).toBeTruthy();
  expect(state.post.mock.calls[0]?.[1].body.expected_revision).toBe(3);
  expect(state.post.mock.calls[0]?.[1].params.header['Idempotency-Key']).toEqual(
    expect.any(String),
  );
});

it('shows the 403 notice and keeps the day list', async () => {
  state.post.mockResolvedValue({
    error: { code: 'FORBIDDEN', message_ar: 'Denied AR', message_en: 'Forbidden EN' },
    response: { status: 403 },
  });
  renderPage();
  await screen.findByText('Synthetic customer');
  clickCancel();
  fireEvent.change(screen.getByLabelText(t('en', 'serviceLineCancel.reason')), {
    target: { value: 'because' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineCancel.submit') }));
  expect((await screen.findByRole('status')).textContent).toContain('Forbidden EN');
  expect(screen.queryByLabelText(t('en', 'serviceLineCancel.reason'))).toBeNull();
  expect(screen.getByText('Synthetic customer')).toBeTruthy();
});
