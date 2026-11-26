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
const averageRows: RatingAverageItem[] = [
  { employee_id: layla, name_ar: null, name_en: 'Layla Synthetic', average: '4.5', count: 6 },
];
const failure = { code: 'X', message_ar: 'x', message_en: 'Synthetic server failure' };
const ok = (data: unknown) => Promise.resolve({ data, response: { status: 200, ok: true } });
const fail = (status: number) => Promise.resolve({ error: failure, response: { status, ok: false } });
const averagesOk = (month = '2026-11') => ok({ items: averageRows, month });

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

const listOk = (comment: string, month = '2026-11') =>
  ok({ items: [rating('01', comment)], next_cursor: null, month });

const handlers: { averages: Answer; list: Answer } = {
  averages: () => averagesOk(),
  list: () => listOk('Visible comment'),
};

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

const refetch = (client: QueryClient, key: readonly unknown[] = scope) =>
  act(() => client.refetchQueries({ queryKey: key, type: 'active' }));

beforeEach(() => {
  api.GET.mockReset();
  handlers.averages = () => averagesOk();
  handlers.list = () => listOk('Visible comment');
  api.GET.mockImplementation((path: string) =>
    path === listPath ? handlers.list() : handlers.averages(),
  );
});

it('hides every dataset behind one refusal when the averages are refused and the list refresh fails', async () => {
  const { client, container } = renderPage();
  expect(await screen.findByText('Visible comment')).toBeTruthy();
  handlers.averages = () => fail(403);
  handlers.list = () => fail(500);
  await refetch(client);
  expect(await screen.findAllByText(t('en', 'ratings.notAllowed'))).toHaveLength(1);
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(container.textContent).not.toContain('Visible comment');
  expect(container.textContent).not.toContain('Layla Synthetic');
});

it('hides the averages and the employee names when only the list is refused', async () => {
  const { client, container } = renderPage();
  expect(await screen.findByText('Visible comment')).toBeTruthy();
  expect(container.textContent).toContain('Layla Synthetic');
  handlers.list = () => fail(403);
  await refetch(client);
  expect(await screen.findAllByText(t('en', 'ratings.notAllowed'))).toHaveLength(1);
  expect(container.textContent).not.toContain('Visible comment');
  expect(container.textContent).not.toContain('Layla Synthetic');
});

it('shows nothing from before a refusal until the list is read again after it', async () => {
  const { client, container } = renderPage();
  expect(await screen.findByText('Visible comment')).toBeTruthy();
  const pending: ((value: unknown) => void)[] = [];
  handlers.averages = () => fail(403);
  handlers.list = () => new Promise((resolve) => pending.push(resolve));
  act(() => void client.refetchQueries({ queryKey: scope, type: 'active' }));
  expect(await screen.findByText(t('en', 'ratings.notAllowed'))).toBeTruthy();

  handlers.averages = () => averagesOk();
  await refetch(client, [...scope, 'averages']);
  await waitFor(() => expect(screen.queryByText(t('en', 'ratings.notAllowed'))).toBeNull());
  expect(screen.getByRole('status')).toBeTruthy();
  expect(container.textContent).not.toContain('Visible comment');
  expect(container.textContent).not.toContain('Layla Synthetic');

  await act(async () => {
    for (const resolve of pending) resolve(await listOk('Fresh comment'));
  });
  expect(await screen.findByText('Fresh comment')).toBeTruthy();
  expect(screen.getAllByText('Layla Synthetic').length).toBeGreaterThan(0);
  expect(screen.queryByText('Visible comment')).toBeNull();
});

it('lets the manager retry a transient first averages failure and then loads the list', async () => {
  handlers.averages = () => fail(500);
  renderPage();
  expect(await screen.findByText('Synthetic server failure')).toBeTruthy();
  expect(api.GET.mock.calls.some(([path]) => path === listPath)).toBe(false);
  handlers.averages = () => averagesOk();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'ratings.retry') }));
  expect(await screen.findByText('Visible comment')).toBeTruthy();
  expect(screen.queryByText('Synthetic server failure')).toBeNull();
});

it('offers no retry when the averages are refused', async () => {
  handlers.averages = () => fail(403);
  renderPage();
  expect(await screen.findByText(t('en', 'ratings.notAllowed'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: t('en', 'ratings.retry') })).toBeNull();
});

it('moves the month field to the month the server names after a rollover', async () => {
  const { client } = renderPage();
  const field = () => screen.getByLabelText(t('en', 'ratings.month')) as HTMLInputElement;
  await screen.findByText('Visible comment');
  expect(field().value).toBe('2026-11');
  handlers.averages = () => averagesOk('2026-12');
  handlers.list = () => listOk('December comment', '2026-12');
  await refetch(client, [...scope, 'averages']);
  expect(await screen.findByText('December comment')).toBeTruthy();
  expect(field().value).toBe('2026-12');
});

it('keeps the month the manager picked when a later refetch names another one', async () => {
  const { client } = renderPage();
  await screen.findByText('Visible comment');
  const field = screen.getByLabelText(t('en', 'ratings.month')) as HTMLInputElement;
  handlers.list = () => listOk('October comment', '2026-10');
  fireEvent.change(field, { target: { value: '2026-10' } });
  expect(await screen.findByText('October comment')).toBeTruthy();
  handlers.averages = () => averagesOk('2026-12');
  await refetch(client, [...scope, 'averages']);
  expect(field.value).toBe('2026-10');
});
