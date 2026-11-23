import type { RatingAverageItem, RatingsListItem, WorkspaceBusinessRead } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RatingsPage } from './ratings-page';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const companyId = '01920000-0000-7000-8000-0000000000c1';
const branchId = '01920000-0000-7000-8000-0000000000b1';
const layla = '01920000-0000-7000-8000-0000000000e1';
const noor = '01920000-0000-7000-8000-0000000000e2';
const listPath = '/v1/businesses/{businessId}/ratings';
const averagesPath = '/v1/businesses/{businessId}/ratings/averages';

const business: WorkspaceBusinessRead = {
  id: companyId,
  name_ar: null,
  name_en: 'Synthetic business',
  branches: [
    {
      id: branchId,
      name_ar: null,
      name_en: 'Synthetic branch',
      effective_timezone: 'Asia/Kuwait',
      is_active: true,
    },
  ],
};

function rating(id: string, over: Partial<RatingsListItem> = {}): RatingsListItem {
  return {
    id: `01920000-0000-7000-8000-0000000000${id}`,
    stars: 5,
    submitted_at: '2026-11-10T09:00:00.000Z',
    business_date: '2026-11-10',
    branch: { id: branchId, name_ar: null, name_en: 'Synthetic branch' },
    performers: [{ employee_id: layla, name_ar: null, name_en: 'Layla Synthetic' }],
    comment: null,
    ...over,
  };
}

function average(employeeId: string, name: string, value: string, count: number) {
  return { employee_id: employeeId, name_ar: null, name_en: name, average: value, count };
}

const averageRows: RatingAverageItem[] = [
  average(noor, 'Noor Synthetic', '3.5', 2),
  average(layla, 'Layla Synthetic', '4.5', 6),
];

function answer(items: RatingsListItem[], next: string | null = null) {
  return Promise.resolve({
    data: { items, next_cursor: next, month: '2026-11' },
    response: { status: 200 },
  });
}

function serve(handlers: {
  list: (query: Record<string, string>) => Promise<unknown>;
  averages?: unknown;
}) {
  api.GET.mockImplementation((path: string, init: { params: { query: Record<string, string> } }) =>
    path === listPath
      ? handlers.list(init.params.query)
      : Promise.resolve(
          handlers.averages ?? {
            data: { items: averageRows, month: init.params.query.month ?? '2026-11' },
            response: { status: 200 },
          },
        ),
  );
}

function queryOf(path: string, index = 0): Record<string, string> {
  const calls = api.GET.mock.calls.filter(([called]) => called === path);
  return calls[index]?.[1].params.query;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DirectionProvider dir="ltr">
        <RatingsPage companyId={companyId} userId="user" business={business} />
      </DirectionProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.GET.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T09:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

it('shows the averages best first and the ratings with their comments as plain text', async () => {
  const hostile = 'Great <b>service</b> see https://example.test/offer';
  serve({ list: () => answer([rating('01', { comment: hostile }), rating('02')]) });
  renderPage();
  const tables = await screen.findAllByRole('table');
  const names = within(tables[0] as HTMLElement)
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.textContent);
  expect(names[0]).toContain('Layla Synthetic');
  expect(names[0]).toContain('4.5');
  expect(names[1]).toContain('Noor Synthetic');
  expect(await screen.findByText(hostile)).toBeTruthy();
  expect(screen.queryByRole('link')).toBeNull();
  expect(document.querySelector('b')).toBeNull();
  expect(screen.getByText(t('en', 'ratings.noComment'))).toBeTruthy();
});

it('asks the averages without a month and the list with the month the server named', async () => {
  serve({ list: () => answer([rating('01')]) });
  renderPage();
  await screen.findAllByRole('table');
  expect(queryOf(listPath)).toMatchObject({ month: '2026-11', limit: 20 });
  expect(queryOf(averagesPath)).not.toHaveProperty('month');
  for (const path of [listPath, averagesPath]) {
    expect(queryOf(path)).not.toHaveProperty('from');
    expect(queryOf(path)).not.toHaveProperty('to');
  }
  expect((screen.getByLabelText(t('en', 'ratings.month')) as HTMLInputElement).value).toBe(
    '2026-11',
  );
});

it('changing the month changes the request and replaces the visible rows', async () => {
  serve({
    list: (query) =>
      answer(
        query.month === '2026-10'
          ? [rating('03', { comment: 'October comment' })]
          : [rating('01', { comment: 'November comment' })],
      ),
  });
  renderPage();
  expect(await screen.findByText('November comment')).toBeTruthy();
  fireEvent.change(screen.getByLabelText(t('en', 'ratings.month')), {
    target: { value: '2026-10' },
  });
  expect(await screen.findByText('October comment')).toBeTruthy();
  expect(screen.queryByText('November comment')).toBeNull();
  const last = api.GET.mock.calls.filter(([path]) => path === listPath).at(-1);
  expect(last?.[1].params.query).toMatchObject({ month: '2026-10' });
  expect(last?.[1].params.query).not.toHaveProperty('from');
});

it('narrows the list by employee on the server and the averages on screen', async () => {
  serve({ list: () => answer([rating('01')]) });
  renderPage();
  await screen.findAllByRole('table');
  fireEvent.change(screen.getByLabelText(t('en', 'ratings.employee')), { target: { value: noor } });
  await waitFor(() =>
    expect(
      api.GET.mock.calls.some(
        ([path, init]) => path === listPath && init.params.query.employee_id === noor,
      ),
    ).toBe(true),
  );
  const [averagesTable] = await screen.findAllByRole('table');
  expect(within(averagesTable as HTMLElement).queryByText('Layla Synthetic')).toBeNull();
  expect(within(averagesTable as HTMLElement).getByText('Noor Synthetic')).toBeTruthy();
});

it('loads the next page with the cursor and hides the button on the last page', async () => {
  serve({
    list: (query) =>
      query.cursor
        ? answer([rating('02', { comment: 'Second page comment' })])
        : answer([rating('01', { comment: 'First page comment' })], 'cursor-2'),
  });
  renderPage();
  await screen.findByText('First page comment');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'ratings.loadMore') }));
  expect(await screen.findByText('Second page comment')).toBeTruthy();
  expect(screen.getByText('First page comment')).toBeTruthy();
  expect(screen.queryByRole('button', { name: t('en', 'ratings.loadMore') })).toBeNull();
});

it('shows the empty texts when the period has no ratings', async () => {
  serve({
    list: () => answer([]),
    averages: { data: { items: [], month: '2026-11' }, response: { status: 200 } },
  });
  renderPage();
  expect(await screen.findByText(t('en', 'ratings.emptyList'))).toBeTruthy();
  expect(screen.getByText(t('en', 'ratings.emptyAverages'))).toBeTruthy();
});

it('shows the error state when the list fails', async () => {
  const failure = { code: 'FAILED', message_ar: 'x', message_en: 'Synthetic server failure' };
  serve({ list: () => Promise.resolve({ error: failure, response: { status: 500 } }) });
  renderPage();
  expect(await screen.findByText('Synthetic server failure')).toBeTruthy();
  expect(screen.getAllByRole('table')).toHaveLength(1);
});

it('shows the refusal text on 403 and never reads the list without a known month', async () => {
  const failure = { code: 'FORBIDDEN', message_ar: 'x', message_en: 'Synthetic refusal' };
  serve({
    list: () => answer([rating('01')]),
    averages: { error: failure, response: { status: 403 } },
  });
  renderPage();
  expect(await screen.findByText(t('en', 'ratings.notAllowed'))).toBeTruthy();
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(api.GET.mock.calls.some(([path]) => path === listPath)).toBe(false);
  expect((screen.getByLabelText(t('en', 'ratings.month')) as HTMLInputElement).disabled).toBe(true);
});
