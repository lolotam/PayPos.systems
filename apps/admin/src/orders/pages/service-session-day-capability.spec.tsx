import type { ReactNode } from 'react';
import type { ServiceSessionDayPage as DayPage } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { id, instant, scope } from '../model/session-recording-result.fixture';
import { ServiceSessionDayPage } from './service-session-day-page';

const state = vi.hoisted(() => ({ get: vi.fn(), online: true as boolean | null }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));
vi.mock('../model/use-browser-connectivity', () => ({
  useBrowserConnectivity: () => state.online,
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
function line(n: number, status: Line['status']): Line {
  return {
    id: id(n),
    service_id: id(5),
    ordinal: 1,
    name_en: `Service ${n}`,
    name_ar: null,
    status,
    revision: 1,
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
        lines: [line(20, 'ACTIVE'), line(22, 'CANCELLED')],
      },
    ],
    next_cursor: null,
  },
  response: { status: 200 },
};
const refused = {
  error: { code: 'FORBIDDEN', message_ar: 'Denied AR', message_en: 'Denied EN' },
  response: { status: 403 },
};

const unavailable = {
  error: { code: 'INTERNAL_ERROR', message_ar: 'Error AR', message_en: 'Error EN' },
  response: { status: 500 },
};

function answer(capability: Promise<unknown> | 'allow') {
  state.get.mockImplementation((path: string) => {
    if (!String(path).includes('/capabilities')) return Promise.resolve(day);
    if (capability === 'allow') {
      return Promise.resolve({ data: { can_cancel_lines: true }, response: { status: 200 } });
    }
    return capability;
  });
}

function deferred() {
  let settle: (value: unknown) => void = () => undefined;
  const promise = new Promise((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    client,
    ...render(<ServiceSessionDayPage scope={scope} timezone="Asia/Kuwait" />, { wrapper }),
  };
}

const cancel = () => screen.queryByRole('button', { name: t('en', 'serviceLineCancel.cancel') });

it('hides Cancel while the capability is loading and after it is false, and still offers details', async () => {
  state.online = true;
  const gate = deferred();
  answer(gate.promise);
  renderPage();
  expect(await screen.findByText('Synthetic customer')).toBeTruthy();
  expect(cancel()).toBeNull();
  expect(screen.getByRole('button', { name: t('en', 'serviceLineCancel.details') })).toBeTruthy();
  await act(async () => {
    gate.settle({ data: { can_cancel_lines: false }, response: { status: 200 } });
  });
  expect(cancel()).toBeNull();
  expect(screen.getByRole('button', { name: t('en', 'serviceLineCancel.details') })).toBeTruthy();
});

it('shows Cancel when the branch capability allows it', async () => {
  state.online = true;
  answer('allow');
  renderPage();
  expect(await screen.findByText('Synthetic customer')).toBeTruthy();
  expect(
    await screen.findByRole('button', { name: t('en', 'serviceLineCancel.cancel') }),
  ).toBeTruthy();
});

it('hides Cancel but keeps the day when the capability read fails without an access refusal', async () => {
  state.online = true;
  const gate = deferred();
  answer(gate.promise);
  renderPage();
  expect(await screen.findByText('Synthetic customer')).toBeTruthy();
  await act(async () => {
    gate.settle(unavailable);
  });
  await waitFor(() => expect(screen.getByText('Synthetic customer')).toBeTruthy());
  expect(cancel()).toBeNull();
});

it('clears the day when the capability read is refused with 403', async () => {
  state.online = true;
  const gate = deferred();
  answer(gate.promise);
  renderPage();
  expect(await screen.findByText('Synthetic customer')).toBeTruthy();
  await act(async () => {
    gate.settle(refused);
  });
  expect((await screen.findByRole('alert')).textContent).toContain('Denied EN');
  await waitFor(() => expect(screen.queryByText('Synthetic customer')).toBeNull());
  expect(cancel()).toBeNull();
});

const recorded = {
  data: {
    generated_at: instant,
    business_timezone: 'Asia/Kuwait',
    recorder_membership_ids: [id(8)],
    recorder_membership_id: id(8),
    discount_limit: { source: 'OWNER' as const, bps: null },
  },
  response: { status: 200 },
};
const tipsButton = () => screen.queryByRole('button', { name: t('en', 'sessionTips.open') });

it('keeps the day and hides Record tip for a reader without record permission', async () => {
  state.online = true;
  const gate = deferred();
  state.get.mockImplementation((path: string) => {
    const name = String(path);
    if (name.includes('/capabilities')) {
      return Promise.resolve({ data: { can_cancel_lines: false }, response: { status: 200 } });
    }
    if (name.includes('recording-context')) return gate.promise;
    return Promise.resolve(day);
  });
  renderPage();
  expect(await screen.findByText('Synthetic customer')).toBeTruthy();
  expect(tipsButton()).toBeNull();
  await act(async () => {
    gate.settle(refused);
  });
  expect(screen.getByText('Synthetic customer')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(tipsButton()).toBeNull();
  expect(state.get.mock.calls.some((call) => String(call[0]).includes('/tips'))).toBe(false);
});

it('shows Record tip when the recording context succeeds', async () => {
  state.online = true;
  state.get.mockImplementation((path: string) => {
    const name = String(path);
    if (name.includes('/capabilities')) {
      return Promise.resolve({ data: { can_cancel_lines: false }, response: { status: 200 } });
    }
    if (name.includes('recording-context')) return Promise.resolve(recorded);
    return Promise.resolve(day);
  });
  renderPage();
  expect(await screen.findByRole('button', { name: t('en', 'sessionTips.open') })).toBeTruthy();
  expect(screen.getByText('Synthetic customer')).toBeTruthy();
});
