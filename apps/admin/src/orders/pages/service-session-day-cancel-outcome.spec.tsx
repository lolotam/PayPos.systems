import type { ReactNode } from 'react';
import type { ServiceSessionDayPage as DayPage } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { id, instant, scope } from '../model/session-recording-result.fixture';
import { ServiceSessionDayPage } from './service-session-day-page';

const state = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get, POST: state.post }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));
vi.mock('../model/use-browser-connectivity', () => ({
  useBrowserConnectivity: () => true,
}));

type Line = DayPage['items'][number]['lines'][number];
const performer = {
  employee_id: id(6),
  name_en: 'Nada',
  name_ar: null,
  share_bps: 10000,
  not_clocked_in_warning: false,
  approved_leave_warning: false,
};
function line(n: number): Line {
  return {
    id: id(n),
    service_id: id(5),
    ordinal: 1,
    name_en: `Service ${n}`,
    name_ar: null,
    status: 'ACTIVE',
    revision: 3,
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
    performers: [{ ...performer, name_en: `Nada ${n}` }],
  };
}
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
        lines: [line(20)],
      },
    ],
    next_cursor: null,
  },
  response: { status: 200 },
};
const allowed = {
  data: { can_cancel_lines: true, can_change_performers: false },
  response: { status: 200 },
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<ServiceSessionDayPage scope={scope} timezone="Asia/Kuwait" />, { wrapper });
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  state.get.mockReset();
  state.post.mockReset();
  state.get.mockImplementation((path: string) =>
    Promise.resolve(String(path).includes('/capabilities') ? allowed : day),
  );
});

async function submitCancelReason() {
  await screen.findByText('Synthetic customer');
  const cancel = t('en', 'serviceLineCancel.cancel');
  await waitFor(() => expect(screen.getAllByRole('button', { name: cancel }).length).toBe(1));
  const button = screen.getAllByRole('button', { name: cancel })[0];
  if (!button) throw new Error('missing cancel button');
  fireEvent.click(button);
  fireEvent.change(screen.getByLabelText(t('en', 'serviceLineCancel.reason')), {
    target: { value: 'because' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineCancel.submit') }));
}

it('clears the day after a narrow cancel even when the refetch fails', async () => {
  let posted = false;
  state.get.mockImplementation((path: string) => {
    if (String(path).includes('/capabilities')) return Promise.resolve(allowed);
    return posted ? Promise.reject(new Error('offline')) : Promise.resolve(day);
  });
  state.post.mockImplementation(() => {
    posted = true;
    return Promise.resolve({ data: { cancelled: true }, response: { status: 200 } });
  });
  renderPage();
  await submitCancelReason();
  await waitFor(() => expect(screen.queryByText('Synthetic customer')).toBeNull());
  expect(screen.getByRole('alert').textContent).toContain(t('en', 'serviceLineCancel.saved'));
  expect(screen.queryByText('Service 20')).toBeNull();
  expect(screen.queryByText('Nada 20')).toBeNull();
  expect(screen.queryByText('10.000')).toBeNull();
  expect(screen.getByLabelText(t('en', 'serviceLineEdit.date'))).toBeTruthy();
});

it('replays the unresolved cancel after the dialog closes', async () => {
  let calls = 0;
  state.post.mockImplementation(() => {
    calls += 1;
    if (calls === 1) return Promise.reject(new Error('offline'));
    if (calls === 2) {
      return Promise.resolve({
        error: {
          code: 'SESSION_LINE_NOT_CANCELLABLE',
          message_ar: 'Not AR',
          message_en: 'Not EN',
        },
        response: { status: 422 },
      });
    }
    return Promise.resolve({ data: { cancelled: true }, response: { status: 200 } });
  });
  renderPage();
  await submitCancelReason();
  expect(await screen.findByText(t('en', 'serviceLineCancel.outcomeUnknown'))).toBeTruthy();
  const first = state.post.mock.calls[0]?.[1];
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineCancel.close') }));
  await waitFor(() =>
    expect(screen.queryByLabelText(t('en', 'serviceLineCancel.reason'))).toBeNull(),
  );
  expect(screen.getByText('Synthetic customer')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineCancel.cancel') }));
  expect(await screen.findByText(t('en', 'serviceLineCancel.outcomeUnknown'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineCancel.submit') }));
  await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
  const second = state.post.mock.calls[1]?.[1];
  expect(second.params.header['Idempotency-Key']).toBe(first.params.header['Idempotency-Key']);
  expect(second.body).toEqual(first.body);
  expect(await screen.findByText('Not EN')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineCancel.submit') }));
  await waitFor(() => expect(state.post).toHaveBeenCalledTimes(3));
  expect(state.post.mock.calls[2]?.[1].params.header['Idempotency-Key']).not.toBe(
    first.params.header['Idempotency-Key'],
  );
});
