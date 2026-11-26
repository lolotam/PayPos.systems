import type { RatingAverageItem, RatingsListItem, WorkspaceBusinessRead } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ratingsKey } from '../api/ratings-client';
import { RatingsPage } from './ratings-page';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

type Init = { params: { query: Record<string, string> } };

const companyId = '01920000-0000-7000-8000-0000000000c1';
const branchId = '01920000-0000-7000-8000-0000000000b1';
const layla = '01920000-0000-7000-8000-0000000000e1';
const listPath = '/v1/businesses/{businessId}/ratings';
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

function rating(id: string, comment: string | null): RatingsListItem {
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
];
const failure = { code: 'X', message_ar: 'x', message_en: 'Synthetic server failure' };
const ok = (data: unknown) => Promise.resolve({ data, response: { status: 200, ok: true } });
const refuse = (status: number) => Promise.resolve({ error: failure, response: { status, ok: false } });
const page = (items: RatingsListItem[], next: string | null = null) =>
  ok({ items, next_cursor: next, month: '2026-11' });

function freshClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function clientWithCachedRatings() {
  const client = freshClient();
  const scope = ratingsKey(companyId, 'user', companyId);
  client.setQueryData([...scope, 'averages', {}], { items: averageRows, month: '2026-11' });
  client.setQueryData([...scope, 'list', { ...novemberRange, limit: 20 }], {
    pages: [{ items: [rating('01', 'Cached comment')], next_cursor: null, month: '2026-11' }],
    pageParams: [undefined],
  });
  return client;
}

function renderPage(client = freshClient()) {
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

it('never shows cached ratings before this visit has read them again, and drops them on 403', async () => {
  api.GET.mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve(refuse(403)), 0)),
  );
  const { container } = renderPage(clientWithCachedRatings());
  expect(screen.queryByText('Cached comment')).toBeNull();
  expect(screen.queryByText('Layla Synthetic')).toBeNull();
  expect(await screen.findAllByText(t('en', 'ratings.notAllowed'))).toHaveLength(1);
  expect(container.textContent).not.toContain('Cached comment');
  expect(container.textContent).not.toContain('Layla Synthetic');
});

it('shows the fresh rows once this visit has read them again', async () => {
  api.GET.mockImplementation((path: string) =>
    path === listPath
      ? page([rating('02', 'Fresh comment')])
      : ok({ items: averageRows, month: '2026-11' }),
  );
  renderPage(clientWithCachedRatings());
  expect(screen.queryByText('Cached comment')).toBeNull();
  expect(await screen.findByText('Fresh comment')).toBeTruthy();
  expect(screen.queryByText('Cached comment')).toBeNull();
});

it('keeps the loaded ratings and offers a retry when the next page fails', async () => {
  let nextAttempts = 0;
  api.GET.mockImplementation((path: string, init: Init) => {
    if (path !== listPath) return ok({ items: averageRows, month: '2026-11' });
    if (!init.params.query.cursor) return page([rating('01', 'First page comment')], 'cursor-2');
    nextAttempts += 1;
    return nextAttempts === 1 ? refuse(500) : page([rating('02', 'Second page comment')]);
  });
  renderPage();
  await screen.findByText('First page comment');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'ratings.loadMore') }));
  expect(await screen.findByText('Synthetic server failure')).toBeTruthy();
  expect(screen.getByText('First page comment')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'ratings.retry') }));
  expect(await screen.findByText('Second page comment')).toBeTruthy();
  expect(screen.getByText('First page comment')).toBeTruthy();
  expect(screen.queryByText('Synthetic server failure')).toBeNull();
});

it('hides the loaded ratings when the next page is refused', async () => {
  api.GET.mockImplementation((path: string, init: Init) => {
    if (path !== listPath) return ok({ items: averageRows, month: '2026-11' });
    return init.params.query.cursor
      ? refuse(403)
      : page([rating('01', 'First page comment')], 'cursor-2');
  });
  renderPage();
  await screen.findByText('First page comment');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'ratings.loadMore') }));
  expect(await screen.findByText(t('en', 'ratings.notAllowed'))).toBeTruthy();
  expect(screen.queryByText('First page comment')).toBeNull();
});

it('ignores a partial or malformed month typed into a plain text field', async () => {
  api.GET.mockImplementation((path: string) =>
    path === listPath
      ? page([rating('01', 'November comment')])
      : ok({ items: averageRows, month: '2026-11' }),
  );
  renderPage();
  await screen.findByText('November comment');
  const input = screen.getByLabelText(t('en', 'ratings.month')) as HTMLInputElement;
  input.type = 'text';
  const callsBefore = api.GET.mock.calls.length;
  for (const typed of ['2026-', 'abc']) fireEvent.change(input, { target: { value: typed } });
  expect(screen.getByText('November comment')).toBeTruthy();
  expect(api.GET.mock.calls.length).toBe(callsBefore);
  fireEvent.blur(input);
  expect(input.value).toBe('2026-11');
  fireEvent.change(input, { target: { value: '2026-10' } });
  await waitFor(() =>
    expect(
      api.GET.mock.calls.some((call) => (call[1] as Init).params.query['month'] === '2026-10'),
    ).toBe(true),
  );
});
