import type { RatingsListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ratingsKey } from '../api/ratings-client';
import { useRatingsList } from '../api/use-ratings-list';
import { RatingsListPanel } from './ratings-list-panel';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const companyId = '01920000-0000-7000-8000-0000000000c1';
const branchId = '01920000-0000-7000-8000-0000000000b1';
const layla = '01920000-0000-7000-8000-0000000000e1';
const scope = ratingsKey(companyId, 'user', companyId);
const failure = { code: 'X', message_ar: 'x', message_en: 'Synthetic server failure' };
const ok = (data: unknown) => Promise.resolve({ data, response: { status: 200, ok: true } });
const fail = (status: number) => Promise.resolve({ error: failure, response: { status, ok: false } });

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

const page = (items: RatingsListItem[], next: string | null = null) =>
  ok({ items, next_cursor: next, month: '2026-11' });

function Harness() {
  const list = useRatingsList(companyId, 'user', companyId, { month: '2026-11' }, '');
  return <RatingsListPanel list={list} />;
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DirectionProvider dir="ltr">
        <Harness />
      </DirectionProvider>
    </QueryClientProvider>,
  );
  return client;
}

const refetchAll = (client: QueryClient) =>
  act(() => client.refetchQueries({ queryKey: scope, type: 'active' }));

beforeEach(() => api.GET.mockReset());

it('never shows the comments again when a transient failure follows a refusal', async () => {
  api.GET.mockImplementationOnce(() => page([rating('01', 'Visible comment')]));
  const client = renderPanel();
  expect(await screen.findByText('Visible comment')).toBeTruthy();

  api.GET.mockImplementationOnce(() => fail(403));
  await refetchAll(client);
  expect(await screen.findByText(t('en', 'ratings.notAllowed'))).toBeTruthy();
  expect(screen.queryByText('Visible comment')).toBeNull();

  api.GET.mockImplementationOnce(() => fail(500));
  await refetchAll(client);
  expect(await screen.findByText('Synthetic server failure')).toBeTruthy();
  expect(screen.queryByText('Visible comment')).toBeNull();
  expect(screen.getByRole('button', { name: t('en', 'ratings.retry') })).toBeTruthy();

  api.GET.mockImplementationOnce(() => page([rating('02', 'Fresh comment')]));
  await refetchAll(client);
  expect(await screen.findByText('Fresh comment')).toBeTruthy();
});

it('keeps Load more disabled during a background refetch and the refetch replaces the rows', async () => {
  api.GET.mockImplementationOnce(() => page([rating('01', 'Old comment')], 'cursor-2'));
  const client = renderPanel();
  expect(await screen.findByText('Old comment')).toBeTruthy();
  const loadMore = () => screen.getByRole('button', { name: t('en', 'ratings.loadMore') });
  expect((loadMore() as HTMLButtonElement).disabled).toBe(false);

  let finish: (value: unknown) => void = () => undefined;
  api.GET.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  act(() => void client.refetchQueries({ queryKey: scope, type: 'active' }));
  await vi.waitFor(() => expect((loadMore() as HTMLButtonElement).disabled).toBe(true));

  await act(async () => finish(await page([rating('02', 'New comment')])));
  expect(await screen.findByText('New comment')).toBeTruthy();
  expect(screen.queryByText('Old comment')).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'ratings.loadMore') })).toBeNull();
});

it('asks for the next page without cancelling a refetch that started before the click', () => {
  const fetchNextPage = vi.fn();
  const stub = {
    data: {
      pages: [{ items: [rating('01', 'Stub comment')], next_cursor: 'c', month: '2026-11' }],
    },
    isError: false,
    isSuccess: true,
    isFetchedAfterMount: true,
    isFetching: false,
    isFetchNextPageError: false,
    hasNextPage: true,
    error: null,
    fetchNextPage,
  } as unknown as Parameters<typeof RatingsListPanel>[0]['list'];
  render(
    <DirectionProvider dir="ltr">
      <RatingsListPanel list={stub} />
    </DirectionProvider>,
  );
  expect(screen.getByText('Stub comment')).toBeTruthy();
  act(() => screen.getByRole('button', { name: t('en', 'ratings.loadMore') }).click());
  expect(fetchNextPage).toHaveBeenCalledWith({ cancelRefetch: false });
});
