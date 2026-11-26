import type { RatingAverageItem, RatingsListItem, WorkspaceBusinessRead } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/shared/api/query-client';
import { ratingsKey } from '../api/ratings-client';
import { RatingsPage } from './ratings-page';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

type Init = { params: { query: Record<string, string> } };

const companyId = '01920000-0000-7000-8000-0000000000c1';
const branchId = '01920000-0000-7000-8000-0000000000b1';
const layla = '01920000-0000-7000-8000-0000000000e1';
const noor = '01920000-0000-7000-8000-0000000000e2';
const listPath = '/v1/businesses/{businessId}/ratings';
const averagesPath = '/v1/businesses/{businessId}/ratings/averages';
const scope = ratingsKey(companyId, 'user', companyId);
const novemberRange = { month: '2026-11' };
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

function rating(id: string, comment: string): RatingsListItem {
  return {
    id: `01920000-0000-7000-8000-0000000000${id}`,
    stars: 5,
    submitted_at: '2026-11-10T09:00:00.000Z',
    business_date: '2026-11-10',
    branch: { id: branchId, name_ar: null, name_en: 'Synthetic branch' },
    performers: [{ employee_id: layla, name_ar: null, name_en: 'Layla Synthetic' }],
    comment,
  };
}

const averageRows: RatingAverageItem[] = [
  { employee_id: layla, name_ar: null, name_en: 'Layla Synthetic', average: '4.5', count: 6 },
  { employee_id: noor, name_ar: null, name_en: 'Noor Synthetic', average: '3.5', count: 2 },
];
const failure = { code: 'X', message_ar: 'x', message_en: 'Synthetic server failure' };
const ok = (data: unknown) => Promise.resolve({ data, response: { status: 200, ok: true } });
const fail500 = () => Promise.resolve({ error: failure, response: { status: 500, ok: false } });
const page = (items: RatingsListItem[], next: string | null = null) =>
  ok({ items, next_cursor: next, month: '2026-11' });

function seed(client: QueryClient) {
  client.setQueryData([...scope, 'averages', {}], { items: averageRows, month: '2026-11' });
  client.setQueryData([...scope, 'list', { ...novemberRange, limit: 20 }], {
    pages: [{ items: [rating('01', 'Cached comment')], next_cursor: null, month: '2026-11' }],
    pageParams: [undefined],
  });
}

function renderPage(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <DirectionProvider dir="ltr">
        <RatingsPage companyId={companyId} userId="user" business={business} />
      </DirectionProvider>
    </QueryClientProvider>,
  );
}

const listCalls = () => api.GET.mock.calls.filter(([path]) => path === listPath);
const lastListQuery = () => (listCalls().at(-1)?.[1] as Init).params.query;

beforeEach(() => {
  api.GET.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T09:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

it('reads again on a reopened page even when the cache is still fresh', async () => {
  api.GET.mockImplementation((path: string) =>
    path === listPath
      ? page([rating('02', 'Fresh comment')])
      : ok({ items: averageRows, month: '2026-11' }),
  );
  const client = createQueryClient();
  seed(client);
  renderPage(client);
  expect(await screen.findByText('Fresh comment')).toBeTruthy();
  expect(screen.queryByText('Cached comment')).toBeNull();
  expect(api.GET.mock.calls.some(([path]) => path === averagesPath)).toBe(true);
  expect(screen.getAllByText('Noor Synthetic').length).toBeGreaterThan(0);
});

it('reads again when switching back to a month that is still fresh in the cache', async () => {
  api.GET.mockImplementation((path: string, init: Init) =>
    path === listPath
      ? page([rating('02', `Comment of ${init.params.query.month}`)])
      : ok({ items: averageRows, month: '2026-11' }),
  );
  renderPage(createQueryClient());
  await screen.findByText('Comment of 2026-11');
  const month = screen.getByLabelText(t('en', 'ratings.month'));
  fireEvent.change(month, { target: { value: '2026-10' } });
  await screen.findByText('Comment of 2026-10');
  fireEvent.change(month, { target: { value: '2026-11' } });
  expect(await screen.findByText('Comment of 2026-11')).toBeTruthy();
  expect(listCalls()).toHaveLength(3);
});

it('never shows cached comments when the refresh of this visit fails, and retries the read', async () => {
  let listAttempts = 0;
  api.GET.mockImplementation((path: string) => {
    if (path !== listPath) return ok({ items: averageRows, month: '2026-11' });
    listAttempts += 1;
    return listAttempts === 1 ? fail500() : page([rating('02', 'Fresh comment')]);
  });
  const client = createQueryClient();
  seed(client);
  const { container } = renderPage(client);
  expect(await screen.findByText('Synthetic server failure')).toBeTruthy();
  expect(container.textContent).not.toContain('Cached comment');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'ratings.retry') }));
  expect(await screen.findByText('Fresh comment')).toBeTruthy();
  expect(container.textContent).not.toContain('Cached comment');
  expect(screen.queryByText('Synthetic server failure')).toBeNull();
});

it('retries the failed refresh itself, not the next page, when rows of this visit stay shown', async () => {
  let firstPageReads = 0;
  api.GET.mockImplementation((path: string, init: Init) => {
    if (path !== listPath) return ok({ items: averageRows, month: '2026-11' });
    if (init.params.query.cursor) return page([rating('03', 'Next page comment')]);
    firstPageReads += 1;
    if (firstPageReads === 2) return fail500();
    return page(
      [rating('01', firstPageReads === 1 ? 'Loaded comment' : 'Refreshed comment')],
      'c2',
    );
  });
  const client = createQueryClient();
  renderPage(client);
  await screen.findByText('Loaded comment');
  await act(() => client.refetchQueries({ queryKey: [...scope, 'list'] }));
  expect(await screen.findByText('Synthetic server failure')).toBeTruthy();
  expect(screen.getByText('Loaded comment')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'ratings.retry') }));
  expect(await screen.findByText('Refreshed comment')).toBeTruthy();
  expect(screen.queryByText('Synthetic server failure')).toBeNull();
  expect(listCalls().some(([, init]) => (init as Init).params.query.cursor)).toBe(false);
});

it('retries exactly the cursor that failed when the next page fails', async () => {
  let nextAttempts = 0;
  api.GET.mockImplementation((path: string, init: Init) => {
    if (path !== listPath) return ok({ items: averageRows, month: '2026-11' });
    if (!init.params.query.cursor) return page([rating('01', 'First page comment')], 'c2');
    nextAttempts += 1;
    return nextAttempts === 1 ? fail500() : page([rating('02', 'Second page comment')]);
  });
  renderPage(createQueryClient());
  await screen.findByText('First page comment');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'ratings.loadMore') }));
  await screen.findByText('Synthetic server failure');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'ratings.retry') }));
  expect(await screen.findByText('Second page comment')).toBeTruthy();
  const cursors = listCalls().map(([, init]) => (init as Init).params.query.cursor);
  expect(cursors).toEqual([undefined, 'c2', 'c2']);
});

it('never shows an employee in the filter that the requests do not carry', async () => {
  let averagesFail = false;
  api.GET.mockImplementation((path: string) => {
    if (path === listPath) return page([rating('01', 'Some comment')]);
    return averagesFail ? fail500() : ok({ items: averageRows, month: '2026-11' });
  });
  const client = createQueryClient();
  renderPage(client);
  await screen.findByText('Some comment');
  const select = screen.getByLabelText(t('en', 'ratings.employee')) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: noor } });
  await waitFor(() => expect(lastListQuery().employee_id).toBe(noor));
  averagesFail = true;
  await act(() => client.refetchQueries({ queryKey: [...scope, 'averages'] }));
  await waitFor(() => expect(lastListQuery()).not.toHaveProperty('employee_id'));
  expect(select.value).toBe('');
});
