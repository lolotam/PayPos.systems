import type { ReactNode } from 'react';
import type { ServiceSessionDayPage as DayPage } from '@pospay/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { id, instant, scope } from '../model/session-recording-result.fixture';
import { ServiceSessionDayPage } from './service-session-day-page';

const state = vi.hoisted(() => ({ get: vi.fn(), online: true as boolean | null }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get, PATCH: vi.fn() }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));
vi.mock('../model/use-browser-connectivity', () => ({ useBrowserConnectivity: () => state.online }));

type Line = DayPage['items'][number]['lines'][number];
const line: Line = {
  id: id(20), service_id: id(5), ordinal: 1, name_en: 'Service 20', name_ar: null, status: 'ACTIVE',
  revision: 1, edited: false, late: false, list_price: '10.000', price: '10.000', discount: '1.000',
  net: '9.000', effective_discount_bps: 1000, recorded_by: id(4), recorded_at: instant,
  has_performer_warning: false,
  performers: [{ employee_id: id(6), name_en: 'Nada', name_ar: null, share_bps: 10000, not_clocked_in_warning: false, approved_leave_warning: false }],
};
const visit = {
  id: id(12), business_id: scope.businessId, branch_id: scope.branchId, customer: { id: id(7), name: 'Synthetic customer' },
  occurred_at: instant, recorded_at: instant, business_date: '2026-10-13', business_timezone: 'Asia/Kuwait',
  recorded_by: scope.userId, late: false, lines: [line],
};
const page = (nextCursor: string | null) => ({ data: { items: [visit], next_cursor: nextCursor }, response: { status: 200 } });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...render(<ServiceSessionDayPage scope={scope} timezone="Asia/Kuwait" />, { wrapper }) };
}

beforeEach(() => {
  state.online = true;
  state.get.mockReset();
});

it('holds the filter bar, the visits and the load-more action in one card, in that order', async () => {
  state.get.mockResolvedValue(page('more'));
  renderPage();
  const customer = await screen.findByText('Synthetic customer');
  const date = screen.getByLabelText('Date');
  const more = screen.getByRole('button', { name: 'Load more' });
  const card = date.closest('.rounded-card') as HTMLElement;
  expect(card.contains(customer)).toBe(true);
  expect(card.contains(more)).toBe(true);
  expect(date.compareDocumentPosition(customer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(customer.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const heading = screen.getByRole('heading', { level: 1, name: 'Day list' });
  expect(heading.closest('[data-page-shell="list"]')?.contains(card)).toBe(true);
});

it('shows no load-more action on the last page', async () => {
  state.get.mockResolvedValue(page(null));
  renderPage();
  await screen.findByText('Synthetic customer');
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
});

it('keeps the filter bar in the card when access is refused and the retry action beside the message', async () => {
  state.get.mockResolvedValue({
    error: { code: 'FORBIDDEN', message_ar: 'Denied AR', message_en: 'Denied EN' },
    response: { status: 403 },
  });
  renderPage();
  const alert = await screen.findByRole('alert');
  const card = alert.closest('.rounded-card') as HTMLElement;
  expect(within(card).getByLabelText('Date')).toBeTruthy();
  expect(within(card).getByRole('button', { name: 'Retry' })).toBeTruthy();
  expect(screen.queryByText('Synthetic customer')).toBeNull();
});

it('keeps the same date input, and keyboard focus on it, when a later read is refused', async () => {
  state.get.mockResolvedValue(page(null));
  const view = renderPage();
  await screen.findByText('Synthetic customer');
  const date = screen.getByLabelText('Date');
  date.focus();
  state.get.mockResolvedValue({
    error: { code: 'FORBIDDEN', message_ar: 'Denied AR', message_en: 'Denied EN' },
    response: { status: 403 },
  });
  await act(async () => {
    await view.client.refetchQueries({ queryKey: ['branch-day-sessions'] });
  });
  expect((await screen.findByRole('alert')).textContent).toContain('Denied EN');
  expect(screen.getByLabelText('Date')).toBe(date);
  expect(document.activeElement).toBe(date);
});
