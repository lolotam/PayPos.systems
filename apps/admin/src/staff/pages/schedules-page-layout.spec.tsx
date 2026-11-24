import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SchedulesPage } from './schedules-page';

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const id = '01920000-0000-7000-8000-000000000101';
const scope = { companyId: id, businessId: id, branchId: id, userId: id };
const branch = {
  id,
  name_ar: null,
  name_en: 'Synthetic branch',
  effective_timezone: 'Asia/Kuwait',
  is_active: true,
};
const days = [
  '2026-10-03',
  '2026-10-04',
  '2026-10-05',
  '2026-10-06',
  '2026-10-07',
  '2026-10-08',
  '2026-10-09',
];
let client: QueryClient;

function weekRead() {
  return {
    data: {
      max_shifts_per_day: 3,
      week_start: days[0],
      timezone: 'Asia/Kuwait',
      days,
      items: [
        {
          employee_id: id,
          name_en: 'Synthetic employee',
          name_ar: null,
          schedule: null,
          default_shifts: [],
        },
      ],
      next_cursor: null,
    },
    response: { status: 200, ok: true },
  };
}

function renderPage() {
  return render(
    <QueryClientProvider client={client}>
      <SchedulesPage scope={scope} branch={branch} />
    </QueryClientProvider>,
  );
}

function cardOf(element: HTMLElement) {
  return element.closest('.rounded-card') as HTMLElement;
}

function follows(a: Node, b: Node) {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.GET.mockResolvedValue(weekRead());
});
afterEach(() => {
  cleanup();
  client.clear();
});

it('puts the week controls, the grid and the paging in one card, in that order, under the heading', async () => {
  renderPage();
  await screen.findByText('Synthetic employee');
  const table = screen.getByRole('table');
  const card = cardOf(table);
  const heading = screen.getByRole('heading', { name: t('en', 'shell.schedule_title') });
  const filter = within(card).getByLabelText(t('en', 'shell.schedule_week'));
  const next = within(card).getByRole('button', { name: t('en', 'shell.schedule_next') });
  expect(follows(filter, table)).toBe(true);
  expect(follows(table, next)).toBe(true);
  expect(heading.closest('[data-page-shell="list"]')?.contains(card)).toBe(true);
  expect(card.contains(heading)).toBe(false);
});

it('labels every stacked cell that has content and leaves the title cell without a label', async () => {
  renderPage();
  await screen.findByText('Synthetic employee');
  // يُقرأ صنف التكديس من نص ثابت هنا: لو أُزيل stacked من الإطار سقط هذا الاختبار.
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
    `${t('en', 'shell.schedule_sat')} ${days[0]}`,
    `${t('en', 'shell.schedule_sun')} ${days[1]}`,
    `${t('en', 'shell.schedule_mon')} ${days[2]}`,
    `${t('en', 'shell.schedule_tue')} ${days[3]}`,
    `${t('en', 'shell.schedule_wed')} ${days[4]}`,
    `${t('en', 'shell.schedule_thu')} ${days[5]}`,
    `${t('en', 'shell.schedule_fri')} ${days[6]}`,
  ]);
});

it('links the header to the schedule settings page', async () => {
  renderPage();
  const link = await screen.findByRole('link', { name: t('en', 'shell.schedule_settings_title') });
  expect(link.getAttribute('href')).toBe('/schedules/settings');
});
