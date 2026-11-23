import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  leaveDecisionRecord as record,
  leaveDecisionScope as scope,
  leaveId,
} from '../api/leave-decision.fixture';
import { LeaveInboxPage } from './leave-inbox-page';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const branches = [
  {
    id: leaveId,
    name_en: 'Synthetic branch',
    name_ar: null,
    is_active: true,
    effective_timezone: 'Asia/Kuwait',
  },
];
const pending = { ...record, status: 'PENDING' as const, can_decide: true, can_revoke: false };
let client: QueryClient;

function listed(items: unknown[], nextCursor: string | null = null) {
  api.GET.mockResolvedValue({ data: { items, next_cursor: nextCursor, request_branch_ids: [] } });
}

function renderPage(onRender: () => void = () => undefined) {
  return render(
    <QueryClientProvider client={client}>
      <Profiler id="inbox" onRender={onRender}>
        <LeaveInboxPage scope={scope} branches={branches} />
      </Profiler>
    </QueryClientProvider>,
  );
}

function cardOf(element: HTMLElement) {
  return element.closest('.rounded-card') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
});

it('puts the filter, the table and the paging in one card, in that order, under the heading', async () => {
  listed([pending], leaveId);
  renderPage();
  await screen.findByText('Synthetic employee');
  const table = screen.getByRole('table');
  const card = cardOf(table);
  const heading = screen.getByRole('heading', { name: t('en', 'leave.inbox') });
  const filter = within(card).getByLabelText(t('en', 'leave.branch'));
  const next = within(card).getByRole('button', { name: t('en', 'leave.next') });
  const follows = (a: Node, b: Node) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
  expect(follows(filter, table)).toBeTruthy();
  expect(follows(table, next)).toBeTruthy();
  expect(heading.closest('[data-page-shell="list"]')?.contains(card)).toBe(true);
  expect(follows(heading, card)).toBeTruthy();
  expect(card.contains(heading)).toBe(false);
});

it('labels every stacked cell that has content and leaves the action cells without a label', async () => {
  listed([pending, { ...record, decision_reason: null, can_revoke: false }]);
  renderPage();
  await screen.findAllByText('Synthetic employee');
  // يُقرأ صنف التكديس من نص ثابت هنا: لو أُزيل stacked من الإطار سقط هذا الاختبار.
  // الجدول هنا داخل غلاف المحرّر، فنبحث عن أقرب سلف يحمل صنف التكديس.
  expect(
    screen.getByRole('table').closest('[class*="max-[599.99px]:[&_table]:block"]'),
  ).not.toBeNull();
  const rows = screen.getAllByRole('row');
  const labels = (row: HTMLElement) =>
    within(row)
      .getAllByRole('cell')
      .map((cell) => cell.getAttribute('data-cell-label'));
  expect(labels(rows[1] as HTMLElement)).toEqual([
    null,
    t('en', 'leave.type'),
    t('en', 'leave.status'),
    null,
    t('en', 'leave.employee'),
    t('en', 'leave.decisionReason'),
    null,
  ]);
  expect(labels(rows[2] as HTMLElement)).toEqual([
    null,
    t('en', 'leave.type'),
    t('en', 'leave.status'),
    null,
    t('en', 'leave.employee'),
    null,
    null,
  ]);
  expect(
    within(rows[1] as HTMLElement).getByRole('button', { name: t('en', 'leave.approve') }),
  ).toBeTruthy();
});

it('sends one inbox request on first mount', async () => {
  listed([pending]);
  renderPage();
  await screen.findByText('Synthetic employee');
  expect(api.GET).toHaveBeenCalledTimes(1);
});

it.each([500, 403])(
  'keeps the very same filter input and its focus when a later read is refused with %i, with no employee and no paging beside the refusal',
  async (status) => {
    listed([pending], leaveId);
    const seen: number[] = [];
    renderPage(() => seen.push(screen.queryAllByText('Synthetic employee').length));
    await screen.findByText('Synthetic employee');
    const from = screen.getByLabelText(t('en', 'leave.from'));
    from.focus();
    api.GET.mockResolvedValue({
      error: { code: 'REFUSED', message_ar: 'Synthetic refusal', message_en: 'Synthetic refusal' },
      response: { status },
    });
    seen.length = 0;
    fireEvent.change(from, { target: { value: '2027-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: t('en', 'leave.applyFilters') }));
    const alert = await screen.findByRole('alert');
    expect(cardOf(alert)).toBe(cardOf(from));
    expect(screen.getByLabelText(t('en', 'leave.from'))).toBe(from);
    expect(document.activeElement).toBe(from);
    expect(seen.every((count) => count === 0)).toBe(true);
    expect(screen.queryByRole('table')).toBeNull();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: t('en', 'leave.next') })).toBeNull(),
    );
  },
);
