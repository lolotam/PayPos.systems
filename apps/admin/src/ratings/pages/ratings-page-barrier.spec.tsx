import type { RatingAverageItem, RatingsListItem, WorkspaceBusinessRead } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ratingsKey } from '../api/ratings-client';
import { RatingsPage } from './ratings-page';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

type Query = { cursor?: string };
type Pending = ((value: unknown) => void)[];

const companyId = '01920000-0000-7000-8000-0000000000c1';
const branchId = '01920000-0000-7000-8000-0000000000b1';
const layla = '01920000-0000-7000-8000-0000000000e1';
const listPath = '/v1/businesses/{businessId}/ratings';
const scope = ratingsKey(companyId, 'user', companyId);
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
const failure = { code: 'X', message_ar: 'x', message_en: 'Synthetic server failure' };
const ok = (data: unknown) => Promise.resolve({ data, response: { status: 200 } });
const fail = (status: number) => Promise.resolve({ error: failure, response: { status } });
const wait = (pending: Pending) => new Promise((resolve) => pending.push(resolve));

const averageRows = (name: string): RatingAverageItem[] => [
  { employee_id: layla, name_ar: null, name_en: name, average: '4.5', count: 6 },
];
const averagesOk = (name = 'Layla Synthetic') => ok({ items: averageRows(name), month: '2026-11' });

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
const pageOk = (id: string, comment: string, next: string | null = null) =>
  ok({ items: [rating(id, comment)], next_cursor: next, month: '2026-11' });

const handlers: { averages: () => Promise<unknown>; list: (query: Query) => Promise<unknown> } = {
  averages: () => averagesOk(),
  list: () => pageOk('01', 'Visible comment'),
};

const listCursors = () =>
  (api.GET.mock.calls as [string, { params: { query: Query } }][])
    .filter(([path]) => path === listPath)
    .map(([, init]) => init.params.query.cursor);
const refetch = (client: QueryClient, key: readonly unknown[]) =>
  act(() => client.refetchQueries({ queryKey: key, type: 'active' }));
const startRefetch = (client: QueryClient, key: readonly unknown[]) =>
  act(() => void client.refetchQueries({ queryKey: key, type: 'active' }));
/** يسيب إشعارات React Query تتوزع على الشاشة قبل ما الاختبار يكمل. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
const answer = (resolve: ((value: unknown) => void) | undefined, value: Promise<unknown>) =>
  act(async () => {
    resolve?.(await value);
  });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <DirectionProvider dir="ltr">
        <RatingsPage companyId={companyId} userId="user" business={business} />
      </DirectionProvider>
    </QueryClientProvider>,
  );
  return { client, ...view };
}

beforeEach(() => {
  api.GET.mockReset();
  handlers.averages = () => averagesOk();
  handlers.list = () => pageOk('01', 'Visible comment');
  api.GET.mockImplementation((path: string, init: { params: { query: Query } }) =>
    path === listPath ? handlers.list(init.params.query) : handlers.averages(),
  );
});

it('shows no page from before a refusal after a failed next page until the first page is read again', async () => {
  const fresh: Pending = [];
  handlers.list = (query) =>
    query.cursor
      ? fail(500)
      : fresh.length === 0 && listCursors().length === 1
        ? pageOk('01', 'Old page-1 comment', 'c2')
        : wait(fresh);
  const { client, container } = renderPage();
  expect(await screen.findByText('Old page-1 comment')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'ratings.loadMore') }));
  expect(await screen.findByText(t('en', 'ratings.retry'))).toBeTruthy();

  handlers.averages = () => fail(403);
  await refetch(client, [...scope, 'averages']);
  expect(await screen.findByText(t('en', 'ratings.notAllowed'))).toBeTruthy();
  handlers.averages = () => averagesOk();
  await refetch(client, [...scope, 'averages']);
  await waitFor(() => expect(screen.queryByText(t('en', 'ratings.notAllowed'))).toBeNull());

  expect(container.textContent).not.toContain('Old page-1 comment');
  expect(screen.queryByRole('button', { name: t('en', 'ratings.retry') })).toBeNull();
  expect(screen.getByRole('status')).toBeTruthy();
  await answer(fresh[0], pageOk('01', 'Fresh page-1 comment'));
  expect(await screen.findByText('Fresh page-1 comment')).toBeTruthy();
  expect(container.textContent).not.toContain('Old page-1 comment');
  expect(listCursors()).toEqual([undefined, 'c2', undefined]);
});

it('never shows an averages answer requested before a second refusal that arrived while the page was refused', async () => {
  const retries: Pending = [];
  const { client, container } = renderPage();
  expect(await screen.findByText('Visible comment')).toBeTruthy();

  handlers.averages = () => fail(403);
  await refetch(client, [...scope, 'averages']);
  expect(await screen.findByText(t('en', 'ratings.notAllowed'))).toBeTruthy();
  handlers.averages = () => wait(retries);
  await startRefetch(client, [...scope, 'averages']);
  await waitFor(() => expect(retries).toHaveLength(1));

  handlers.list = () => fail(403);
  await refetch(client, [...scope, 'list']);
  await settle();
  handlers.list = () => pageOk('01', 'Visible comment');
  await refetch(client, [...scope, 'list']);

  await answer(retries[0], averagesOk('Stale Employee'));
  await settle();
  expect(container.textContent).not.toContain('Stale Employee');
  expect(screen.queryByText(t('en', 'ratings.notAllowed'))).toBeNull();
  await answer(retries[1], averagesOk('Fresh Employee'));
  expect(await screen.findAllByText('Fresh Employee')).not.toHaveLength(0);
  expect(container.textContent).not.toContain('Stale Employee');
  expect(await screen.findByText('Visible comment')).toBeTruthy();
});

it('never shows a list read that settled in the same moment the averages were refused', async () => {
  const pending: Pending = [];
  const fresh: Pending = [];
  const { client, container } = renderPage();
  expect(await screen.findByText('Visible comment')).toBeTruthy();

  handlers.list = () => wait(pending);
  await startRefetch(client, [...scope, 'list']);
  await waitFor(() => expect(pending).toHaveLength(1));
  handlers.list = () => wait(fresh);
  handlers.averages = () => fail(403);
  const settled = await pageOk('01', 'Settled comment');
  await act(async () => {
    void client.refetchQueries({ queryKey: [...scope, 'averages'], type: 'active' });
    pending[0]?.(settled);
  });
  expect(await screen.findByText(t('en', 'ratings.notAllowed'))).toBeTruthy();

  handlers.averages = () => averagesOk();
  await refetch(client, [...scope, 'averages']);
  await waitFor(() => expect(screen.queryByText(t('en', 'ratings.notAllowed'))).toBeNull());
  expect(container.textContent).not.toContain('Settled comment');
  expect(container.textContent).not.toContain('Visible comment');
  await answer(fresh[0], pageOk('01', 'Fresh comment'));
  expect(await screen.findByText('Fresh comment')).toBeTruthy();
  expect(container.textContent).not.toContain('Settled comment');
});

it('reads every page again after a next page refused on its own, before anything shows', async () => {
  const fresh: Pending = [];
  handlers.list = (query) =>
    query.cursor
      ? fail(403)
      : listCursors().length === 1
        ? pageOk('01', 'Old page-1 comment', 'c2')
        : wait(fresh);
  const { client, container } = renderPage();
  expect(await screen.findByText('Old page-1 comment')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'ratings.loadMore') }));
  expect(await screen.findByText(t('en', 'ratings.notAllowed'))).toBeTruthy();
  expect(container.textContent).not.toContain('Old page-1 comment');

  act(() => void client.refetchQueries({ queryKey: [...scope, 'list'], type: 'active' }));
  await waitFor(() => expect(fresh).toHaveLength(1));
  expect(container.textContent).not.toContain('Old page-1 comment');
  await answer(fresh[0], pageOk('01', 'Reread page-1 comment'));
  expect(await screen.findByText('Reread page-1 comment')).toBeTruthy();
  expect(container.textContent).not.toContain('Old page-1 comment');
  expect(listCursors()).toEqual([undefined, 'c2', undefined]);
});

it('never appends a next page that was pending at the refusal and shows no earlier page until they are read again', async () => {
  const late: Pending = [];
  const fresh: Pending = [];
  handlers.list = (query) =>
    query.cursor
      ? wait(late)
      : listCursors().length === 1
        ? pageOk('01', 'Old page-1 comment', 'c2')
        : wait(fresh);
  const { client, container } = renderPage();
  expect(await screen.findByText('Old page-1 comment')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'ratings.loadMore') }));
  await waitFor(() => expect(late).toHaveLength(1));

  handlers.averages = () => fail(403);
  await refetch(client, [...scope, 'averages']);
  expect(await screen.findByText(t('en', 'ratings.notAllowed'))).toBeTruthy();
  await waitFor(() => expect(fresh).toHaveLength(1));
  handlers.averages = () => averagesOk();
  await refetch(client, [...scope, 'averages']);
  await waitFor(() => expect(screen.queryByText(t('en', 'ratings.notAllowed'))).toBeNull());

  await answer(late[0], pageOk('02', 'Late page-2 comment'));
  expect(container.textContent).not.toContain('Late page-2 comment');
  expect(container.textContent).not.toContain('Old page-1 comment');
  await answer(fresh[0], pageOk('01', 'Fresh page-1 comment'));
  expect(await screen.findByText('Fresh page-1 comment')).toBeTruthy();
  expect(container.textContent).not.toContain('Late page-2 comment');
  expect(container.textContent).not.toContain('Old page-1 comment');
  expect(listCursors()).toEqual([undefined, 'c2', undefined]);
});
