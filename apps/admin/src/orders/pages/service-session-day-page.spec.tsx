import type { ReactNode } from 'react';
import type { ServiceSessionDayPage as DayPage } from '@pospay/contracts';
import { formatInstant, t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { id, instant, scope } from '../model/session-recording-result.fixture';
import { ServiceSessionDayPage } from './service-session-day-page';

const state = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), online: true as boolean | null, locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get, PATCH: state.patch }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('../model/use-browser-connectivity', () => ({ useBrowserConnectivity: () => state.online }));
type Line = DayPage['items'][number]['lines'][number];
const performer = { employee_id: id(6), name_en: 'Nada', name_ar: null, share_bps: 10000, not_clocked_in_warning: false, approved_leave_warning: false };
function line(n: number, status: Line['status'], revision: number, edited: boolean, late = false): Line {
  return { id: id(n), service_id: id(5), ordinal: 1, name_en: `Service ${n}`, name_ar: null, status, revision, edited, late,
    list_price: '10.000', price: '10.000', discount: '1.000', net: '9.000', effective_discount_bps: 1000, recorded_by: id(4),
    recorded_at: instant, has_performer_warning: false, performers: [{ ...performer, name_en: `Nada ${n}` }] };
}
const visit = { id: id(12), business_id: scope.businessId, branch_id: scope.branchId, customer: { id: id(7), name: 'Synthetic customer' },
  occurred_at: instant, recorded_at: instant, business_date: '2026-10-13', business_timezone: 'Asia/Kuwait', recorded_by: scope.userId, late: false,
  lines: [line(20, 'ACTIVE', 3, false), line(21, 'ACTIVE', 2, true), line(22, 'CANCELLED', 1, false)] };
const edit = { revision: 2, previous: { price: '10.000', discount: '1.000', net: '9.000' }, new: { price: '8.000', discount: '0.000', net: '8.000' },
  changed_at: instant, editor_label_ar: 'Label AR', editor_label_en: 'Label EN', reason: 'Wrong price' };
const day = { data: { items: [visit], next_cursor: null }, response: { status: 200 } };
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<ServiceSessionDayPage scope={scope} timezone="Asia/Kuwait" />, { wrapper });
}

it('marks a line only when edited is true, hides edit on a cancelled line, and shows history in the locale', async () => {
  state.online = true; state.locale = 'en'; state.get.mockReset();
  state.get.mockImplementation((path: string) => Promise.resolve(String(path).includes('/edits') ? { data: { items: [edit], next_cursor: null }, response: { status: 200 } } : day));
  renderPage();
  expect(await screen.findByText('Synthetic customer')).toBeTruthy();
  expect(screen.getAllByText(t('en', 'serviceLineEdit.edited'))).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: t('en', 'serviceLineEdit.edit') })).toHaveLength(2);
  expect(screen.getAllByRole('button', { name: t('en', 'serviceLineEdit.history') })).toHaveLength(1);
  expect(screen.getByText('Nada 21')).toBeTruthy();
  expect(screen.getByText(formatInstant(new Date(instant), 'en', 'Asia/Kuwait'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.history') }));
  expect(await screen.findByText('Label EN', { exact: false })).toBeTruthy();
  expect(screen.getByText('Wrong price')).toBeTruthy();
});

it('retries a failed history read and pauses the list while offline', async () => {
  state.online = true; state.locale = 'en'; let fail = true; state.get.mockReset();
  state.get.mockImplementation((path: string) => {
    if (!String(path).includes('/edits')) return Promise.resolve(day);
    return Promise.resolve(fail ? { error: { code: 'X', message_ar: 'Hist AR', message_en: 'Hist EN' }, response: { status: 503 } } : { data: { items: [edit], next_cursor: null }, response: { status: 200 } });
  });
  const view = renderPage();
  await screen.findByText('Synthetic customer');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.history') }));
  expect(await screen.findByRole('button', { name: t('en', 'serviceLineEdit.retry') })).toBeTruthy();
  fail = false; fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.retry') }));
  expect(await screen.findByText('Wrong price')).toBeTruthy();
  view.unmount(); state.online = false; state.get.mockClear(); renderPage();
  expect(screen.getByText(t('en', 'serviceSessions.offline'))).toBeTruthy();
  expect(state.get).not.toHaveBeenCalled();
});

it('keeps the other line draft when an earlier save settles', async () => {
  state.online = true; state.locale = 'en'; state.get.mockReset(); state.patch.mockReset();
  state.get.mockResolvedValue(day);
  let settle: (value: { data: { saved: true; edited: true }; response: { status: 200 } }) => void = () => undefined;
  state.patch.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
  renderPage();
  await screen.findByText('Synthetic customer');
  const edit = t('en', 'serviceLineEdit.edit');
  const buttons = screen.getAllByRole('button', { name: edit });
  const first = buttons[0];
  const second = buttons[1];
  if (!first || !second) throw new Error('missing edit buttons');
  fireEvent.click(first);
  fireEvent.change(screen.getByLabelText(t('en', 'serviceLineEdit.reason')), { target: { value: 'from a' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.save') }));
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(1));
  fireEvent.click(second);
  fireEvent.change(screen.getByLabelText(t('en', 'serviceLineEdit.reason')), { target: { value: 'from b' } });
  await act(async () => { settle({ data: { saved: true, edited: true }, response: { status: 200 } }); });
  expect(await screen.findByText(t('en', 'serviceLineEdit.saved'))).toBeTruthy();
  expect((screen.getByLabelText(t('en', 'serviceLineEdit.reason')) as HTMLInputElement).value).toBe('from b');
});

it('keeps a reopened line draft when its earlier save settles', async () => {
  state.online = true; state.locale = 'en'; state.get.mockReset(); state.patch.mockReset();
  state.get.mockResolvedValue(day);
  let settle: (value: { data: { saved: true; edited: true }; response: { status: 200 } }) => void = () => undefined;
  state.patch.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
  renderPage();
  await screen.findByText('Synthetic customer');
  const editName = t('en', 'serviceLineEdit.edit');
  const first = screen.getAllByRole('button', { name: editName })[0];
  if (!first) throw new Error('missing edit button');
  fireEvent.click(first);
  fireEvent.change(screen.getByLabelText(t('en', 'serviceLineEdit.reason')), { target: { value: 'from a' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.save') }));
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.close') }));
  const reopened = screen.getAllByRole('button', { name: editName })[0];
  if (!reopened) throw new Error('missing edit button');
  fireEvent.click(reopened);
  fireEvent.change(screen.getByLabelText(t('en', 'serviceLineEdit.reason')), { target: { value: 'reopened' } });
  await act(async () => { settle({ data: { saved: true, edited: true }, response: { status: 200 } }); });
  expect(await screen.findByText(t('en', 'serviceLineEdit.saved'))).toBeTruthy();
  expect((screen.getByLabelText(t('en', 'serviceLineEdit.reason')) as HTMLInputElement).value).toBe('reopened');
});

it('uses the locale direction on the day list', async () => {
  state.online = true; state.locale = 'ar'; state.get.mockReset();
  state.get.mockResolvedValue({ data: { items: [], next_cursor: null }, response: { status: 200 } });
  const view = renderPage();
  expect(view.container.querySelector('section')?.getAttribute('dir')).toBe('rtl');
  expect(await screen.findByRole('heading', { name: t('ar', 'serviceLineEdit.title') })).toBeTruthy();
  state.locale = 'en';
});
