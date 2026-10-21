import type { ReactNode } from 'react';
import type { ServiceSessionDayPage as DayPage } from '@pospay/contracts';
import { formatInstant, serviceSessionErrors, t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { id, instant, savedLine, scope } from '../model/session-recording-result.fixture';
import { ServiceSessionDayPage } from './service-session-day-page';

const state = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get, PUT: state.put }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));
vi.mock('../model/use-browser-connectivity', () => ({ useBrowserConnectivity: () => true }));

type Line = DayPage['items'][number]['lines'][number];
type Answer = { data?: unknown; error?: unknown; response?: { status: number } };
const flags = { not_clocked_in_warning: false, approved_leave_warning: false };
const nada = { employee_id: id(6), name_en: 'Nada', name_ar: null, share_bps: 10000, ...flags };
function line(n: number, changedAt?: string): Line {
  return {
    id: id(n),
    service_id: id(5),
    ordinal: 1,
    name_en: `Service ${n}`,
    name_ar: null,
    status: 'ACTIVE',
    revision: 2,
    edited: false,
    late: false,
    list_price: '10.000',
    price: '10.000',
    discount: '0.000',
    net: '10.000',
    effective_discount_bps: 0,
    recorded_by: id(4),
    recorded_at: instant,
    has_performer_warning: false,
    performers: [nada],
    ...(changedAt ? { performers_changed_at: changedAt } : {}),
  };
}
function dayWith(lines: Line[]) {
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
    lines,
  };
  return { data: { items: [visit], next_cursor: null }, response: { status: 200 } };
}
const change = (revision: number, reason: string) => ({
  revision,
  changed_at: '2026-10-17T07:30:00.000Z',
  changer_label_ar: 'Label AR',
  changer_label_en: 'Layla — Salmiya',
  reason,
  before: [{ name_ar: null, name_en: 'Sara', share_bps: 10000 }],
  after: [
    { name_ar: null, name_en: 'Sara', share_bps: 7000 },
    { name_ar: null, name_en: 'Rana', share_bps: 3000 },
  ],
});
const options = {
  items: [{ id: id(6), name_en: 'Nada', name_ar: null, employee_number: 1, ...flags }],
  next_cursor: null,
};
const context = {
  generated_at: instant,
  business_timezone: 'Asia/Kuwait',
  recorder_membership_ids: [id(8)],
  recorder_membership_id: null,
  discount_limit: null,
};
let day: () => Answer;
let history: (query: { cursor?: string }) => Answer;
function route(
  path: string,
  options_: { params?: { query?: { cursor?: string } } },
): Promise<Answer> {
  if (path.endsWith('/capabilities'))
    return Promise.resolve({ data: { can_cancel_lines: false }, response: { status: 200 } });
  if (path.endsWith('/recording-context'))
    return Promise.resolve({ data: context, response: { status: 200 } });
  if (path.endsWith('/performer-options')) return Promise.resolve({ data: options });
  if (path.endsWith('/performer-changes'))
    return Promise.resolve(history(options_.params?.query ?? {}));
  return Promise.resolve(day());
}
function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<ServiceSessionDayPage scope={scope} timezone="Asia/Kuwait" />, { wrapper });
  return client;
}
const changed = t('en', 'serviceLinePerformers.changed');
// النص متقسّم بين العنصر و<bdi>؛ المطابقة على أعمق عنصر نصه الكامل هو المطلوب.
const whole = (text: string) => (_: string, element: Element | null) =>
  element?.textContent === text &&
  Array.from(element.children).every((child) => child.textContent !== text);
const historyButton = () =>
  screen.getByRole('button', { name: t('en', 'serviceLinePerformers.history') });
async function openEditor() {
  const [first] = await screen.findAllByRole('button', {
    name: t('en', 'serviceLinePerformers.change'),
  });
  if (!first) throw new Error('missing change button');
  fireEvent.click(first);
  await screen.findByRole('option', { name: 'Nada (1)' }, { timeout: 4000 });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceLinePerformers.reason')), {
    target: { value: 'swap' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLinePerformers.submit') }));
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  state.get.mockReset();
  state.put.mockReset();
  day = () => dayWith([line(20, '2026-10-17'), line(21)]);
  history = () => ({ data: { items: [change(3, 'Rana did the rinse')], next_cursor: null } });
  state.get.mockImplementation(route);
});

it('shows the changed mark with its business date and the history button only on a changed line', async () => {
  renderPage();
  expect(await screen.findByText(whole(`${changed} October 17, 2026`))).toBeTruthy();
  expect(
    screen.getAllByText(t('en', 'serviceLinePerformers.changed'), { exact: false }),
  ).toHaveLength(1);
  expect(
    screen.getAllByRole('button', { name: t('en', 'serviceLinePerformers.history') }),
  ).toHaveLength(1);
  expect(
    screen.getAllByRole('button', { name: t('en', 'serviceLinePerformers.change') }),
  ).toHaveLength(2);
});

it('opens the history newest first with the changer, reason and both sides, and loads more by cursor', async () => {
  history = (query) =>
    query.cursor
      ? { data: { items: [change(2, 'first split')], next_cursor: null } }
      : { data: { items: [change(3, 'Rana did the rinse')], next_cursor: 'next-page' } };
  renderPage();
  fireEvent.click(
    await screen.findByRole('button', { name: t('en', 'serviceLinePerformers.history') }),
  );
  expect(
    await screen.findByText(whole(`${t('en', 'serviceLinePerformers.reason')} Rana did the rinse`)),
  ).toBeTruthy();
  expect(historyButton().getAttribute('aria-expanded')).toBe('true');
  expect(
    screen.getByText(`${t('en', 'serviceLinePerformers.changer')} Layla — Salmiya`),
  ).toBeTruthy();
  expect(
    screen.getAllByText(formatInstant(new Date('2026-10-17T07:30:00.000Z'), 'en', 'Asia/Kuwait')),
  ).toHaveLength(1);
  expect(
    screen.getByText(whole(`${t('en', 'serviceLinePerformers.before')} Sara 100.00%`)),
  ).toBeTruthy();
  expect(
    screen.getByText(whole(`${t('en', 'serviceLinePerformers.after')} Sara 70.00%, Rana 30.00%`)),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLinePerformers.more') }));
  expect(
    await screen.findByText(whole(`${t('en', 'serviceLinePerformers.reason')} first split`)),
  ).toBeTruthy();
  const reasons = screen.getAllByText(
    (_, element) =>
      element?.tagName === 'P' &&
      (element.textContent ?? '').startsWith(`${t('en', 'serviceLinePerformers.reason')} `),
  );
  expect(reasons.map((node) => node.textContent)).toEqual([
    `${t('en', 'serviceLinePerformers.reason')} Rana did the rinse`,
    `${t('en', 'serviceLinePerformers.reason')} first split`,
  ]);
  expect(screen.queryByRole('button', { name: t('en', 'serviceLinePerformers.more') })).toBeNull();
  const cursors = state.get.mock.calls
    .filter(([path]) => String(path).endsWith('/performer-changes'))
    .map(([, request]) => request.params.query.cursor);
  expect(cursors).toEqual([undefined, 'next-page']);
});

it('closes the page with the refusal when the history read is forbidden', async () => {
  history = () => ({
    error: { code: 'FORBIDDEN', message_ar: 'Denied AR', message_en: 'Read not allowed' },
    response: { status: 403 },
  });
  renderPage();
  fireEvent.click(
    await screen.findByRole('button', { name: t('en', 'serviceLinePerformers.history') }),
  );
  const alerts = await screen.findAllByText('Read not allowed', { exact: false });
  expect(alerts.length).toBeGreaterThan(0);
  await waitFor(() => expect(screen.queryByText('Service 20')).toBeNull());
});

it('shows the mark, closes the dialog and confirms after a saved change', async () => {
  day = () => dayWith([line(20), line(21)]);
  state.put.mockImplementation(() => {
    day = () => dayWith([line(20, '2026-10-21'), line(21)]);
    return Promise.resolve({
      data: {
        line: { ...savedLine, id: id(20), revision: 3, performers_changed_at: '2026-10-21' },
        session: { id: id(12), total_net: '20.000' },
      },
      response: { status: 200 },
    });
  });
  renderPage();
  expect(await screen.findByText('Service 20')).toBeTruthy();
  expect(screen.queryByText(t('en', 'serviceLinePerformers.changed'), { exact: false })).toBeNull();
  await openEditor();
  expect(await screen.findByText(t('en', 'serviceLinePerformers.saved'))).toBeTruthy();
  expect(await screen.findByText(whole(`${changed} October 21, 2026`))).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(state.put.mock.calls[0]?.[1].body.expected_revision).toBe(2);
});

it('closes the dialog and shows the 403 refusal as a notice on the day list', async () => {
  state.put.mockResolvedValue({
    error: {
      code: 'SESSION_PERFORMER_SELF_FORBIDDEN',
      ...serviceSessionErrors.SESSION_PERFORMER_SELF_FORBIDDEN,
    },
    response: { status: 403 },
  });
  renderPage();
  await openEditor();
  const notice = await screen.findByText(
    serviceSessionErrors.SESSION_PERFORMER_SELF_FORBIDDEN.message_en,
  );
  expect(notice.getAttribute('role')).toBe('status');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByText('Service 20')).toBeTruthy();
});

it.each([
  [401, 'UNAUTHENTICATED'],
  [403, 'FEATURE_DISABLED'],
] as const)(
  'locks the page on a %s %s change and drops the cached performer history',
  async (status, code) => {
    state.put.mockResolvedValue({
      error: { code, message_ar: 'Locked AR', message_en: 'Access withdrawn' },
      response: { status },
    });
    const client = renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: t('en', 'serviceLinePerformers.history') }),
    );
    expect(
      await screen.findByText(
        whole(`${t('en', 'serviceLinePerformers.reason')} Rana did the rinse`),
      ),
    ).toBeTruthy();
    expect(
      client.getQueryCache().findAll({ queryKey: ['service-line-performer-changes'] }),
    ).not.toHaveLength(0);
    await openEditor();
    await waitFor(() =>
      expect(screen.getAllByRole('alert').map((n) => n.textContent)).toEqual([
        `Access withdrawn ${t('en', 'serviceLineEdit.retry')}`,
      ]),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Service 20')).toBeNull();
    expect(
      screen.queryByText(whole(`${t('en', 'serviceLinePerformers.reason')} Rana did the rinse`)),
    ).toBeNull();
    await waitFor(() =>
      expect(
        client.getQueryCache().findAll({ queryKey: ['service-line-performer-changes'] }),
      ).toHaveLength(0),
    );
  },
);

it('closes with a notice when the stale refresh finds the line cancelled meanwhile', async () => {
  day = () => dayWith([line(20), line(21)]);
  state.put.mockImplementation(() => {
    day = () =>
      dayWith([
        { ...line(20), status: 'CANCELLED', revision: 3, cancelled_at: '2026-10-21T06:00:00.000Z' },
        line(21),
      ]);
    return Promise.resolve({
      error: {
        code: 'SESSION_LINE_REVISION_STALE',
        ...serviceSessionErrors.SESSION_LINE_REVISION_STALE,
        details: { current_revision: 3 },
      },
      response: { status: 409 },
    });
  });
  renderPage();
  await openEditor();
  const notice = await screen.findByText(t('en', 'serviceLinePerformers.cancelledMeanwhile'));
  expect(notice.getAttribute('role')).toBe('status');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(await screen.findByText(t('en', 'serviceLineCancel.cancelled'))).toBeTruthy();
});
