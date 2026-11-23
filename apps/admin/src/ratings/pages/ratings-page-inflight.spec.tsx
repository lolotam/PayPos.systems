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

type Answer = () => Promise<unknown>;
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
const fail403 = () => Promise.resolve({ error: failure, response: { status: 403 } });

const averageRows = (name: string): RatingAverageItem[] => [
  { employee_id: layla, name_ar: null, name_en: name, average: '4.5', count: 6 },
];
const averagesOk = (name = 'Layla Synthetic', month = '2026-11') =>
  ok({ items: averageRows(name), month });

function rating(comment: string): RatingsListItem {
  return {
    id: '01920000-0000-7000-8000-000000000001',
    stars: 5,
    submitted_at: '2026-11-10T09:00:00.000Z',
    business_date: '2026-11-10',
    branch: { id: branchId, name_ar: null, name_en: 'Synthetic branch' },
    performers: [{ employee_id: layla, name_ar: null, name_en: 'Layla Synthetic' }],
    comment,
  };
}
const listOk = (comment: string, month = '2026-11') =>
  ok({ items: [rating(comment)], next_cursor: null, month });

const handlers: { averages: Answer; list: Answer } = {
  averages: () => averagesOk(),
  list: () => listOk('Visible comment'),
};

const held =
  (pending: Pending): Answer =>
  () =>
    new Promise((resolve) => {
      pending.push(resolve);
    });
const calls = (list: boolean) =>
  api.GET.mock.calls.filter(([path]) => (path === listPath) === list);
const refetch = (client: QueryClient, key: readonly unknown[]) =>
  act(() => client.refetchQueries({ queryKey: key, type: 'active' }));

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
  handlers.list = () => listOk('Visible comment');
  api.GET.mockImplementation((path: string) =>
    path === listPath ? handlers.list() : handlers.averages(),
  );
});

it('never shows a list read that was in flight when the averages were refused', async () => {
  const pending: Pending = [];
  handlers.list = held(pending);
  const { client, container } = renderPage();
  await waitFor(() => expect(pending).toHaveLength(1));

  handlers.averages = fail403;
  await refetch(client, [...scope, 'averages']);
  expect(await screen.findByText(t('en', 'ratings.notAllowed'))).toBeTruthy();
  await waitFor(() => expect(pending).toHaveLength(2));

  handlers.averages = () => averagesOk();
  await refetch(client, [...scope, 'averages']);
  await waitFor(() => expect(screen.queryByText(t('en', 'ratings.notAllowed'))).toBeNull());

  await act(async () => {
    pending[0]?.(await listOk('Stale comment'));
  });
  expect(container.textContent).not.toContain('Stale comment');
  await act(async () => {
    pending[1]?.(await listOk('Fresh comment'));
  });
  expect(await screen.findByText('Fresh comment')).toBeTruthy();
  expect(container.textContent).not.toContain('Stale comment');
  expect(calls(true)).toHaveLength(2);
});

it('never shows an averages read that was in flight when the list was refused', async () => {
  const pending: Pending = [];
  const { client, container } = renderPage();
  expect(await screen.findByText('Visible comment')).toBeTruthy();

  handlers.averages = held(pending);
  handlers.list = fail403;
  const field = screen.getByLabelText(t('en', 'ratings.month'));
  fireEvent.change(field, { target: { value: '2026-10' } });
  expect(await screen.findByText(t('en', 'ratings.notAllowed'))).toBeTruthy();
  await waitFor(() => expect(pending).toHaveLength(2));

  handlers.list = () => listOk('October comment', '2026-10');
  await refetch(client, [...scope, 'list']);
  expect(await screen.findByText('October comment')).toBeTruthy();

  await act(async () => {
    pending[0]?.(await averagesOk('Stale Employee', '2026-10'));
  });
  expect(container.textContent).not.toContain('Stale Employee');
  await act(async () => {
    pending[1]?.(await averagesOk('Fresh Employee', '2026-10'));
  });
  expect(await screen.findAllByText('Fresh Employee')).not.toHaveLength(0);
  expect(container.textContent).not.toContain('Stale Employee');
  expect(calls(false)).toHaveLength(3);
});
