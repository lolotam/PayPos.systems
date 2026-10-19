import type { ReactNode } from 'react';
import type { ServiceSessionDayPage as DayPage } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
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

it('hides Cancel when the capability read fails', async () => {
  state.online = true;
  const gate = deferred();
  answer(gate.promise);
  renderPage();
  expect(await screen.findByText('Synthetic customer')).toBeTruthy();
  await act(async () => {
    gate.settle(refused);
  });
  expect(cancel()).toBeNull();
  expect(screen.getByText('Synthetic customer')).toBeTruthy();
});
