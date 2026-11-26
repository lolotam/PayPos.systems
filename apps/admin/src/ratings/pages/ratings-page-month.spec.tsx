import type { RatingAverageItem, RatingsListItem, WorkspaceBusinessRead } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RatingsPage } from './ratings-page';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

type Init = { params: { query: Record<string, string> } };

const companyId = '01920000-0000-7000-8000-0000000000c1';
const branchId = '01920000-0000-7000-8000-0000000000b1';
const layla = '01920000-0000-7000-8000-0000000000e1';
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
      effective_timezone: 'America/Los_Angeles',
      is_active: true,
    },
  ],
};

function rating(id: string, comment: string): RatingsListItem {
  return {
    id: `01920000-0000-7000-8000-0000000000${id}`,
    stars: 5,
    submitted_at: '2026-12-01T09:00:00.000Z',
    business_date: '2026-12-01',
    branch: { id: branchId, name_ar: null, name_en: 'Synthetic branch' },
    performers: [{ employee_id: layla, name_ar: null, name_en: 'Layla Synthetic' }],
    comment,
  };
}

const averageRows: RatingAverageItem[] = [
  { employee_id: layla, name_ar: null, name_en: 'Layla Synthetic', average: '4.5', count: 6 },
];
const ok = (data: unknown) => Promise.resolve({ data, response: { status: 200, ok: true } });
const monthField = () => screen.getByLabelText(t('en', 'ratings.month')) as HTMLInputElement;
const callsTo = (path: string) => api.GET.mock.calls.filter(([called]) => called === path);

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
  vi.setSystemTime(new Date('2026-11-30T21:30:00.000Z'));
});
afterEach(() => vi.useRealTimers());

it('shows the month the server named even when the browser clock is in the neighbouring month', async () => {
  api.GET.mockImplementation((path: string) =>
    path === listPath
      ? ok({ items: [rating('01', 'December comment')], next_cursor: null, month: '2026-12' })
      : ok({ items: averageRows, month: '2026-12' }),
  );
  renderPage();
  expect(await screen.findByText('December comment')).toBeTruthy();
  expect(monthField().value).toBe('2026-12');
  expect(monthField().disabled).toBe(false);
  expect((callsTo(listPath)[0]?.[1] as Init).params.query.month).toBe('2026-12');
  expect((callsTo(averagesPath)[0]?.[1] as Init).params.query).not.toHaveProperty('month');
  const sent = api.GET.mock.calls.map(([, init]) => (init as Init).params.query.month);
  expect(sent).not.toContain('2026-11');
});

it('keeps the month field empty and the list unread until the first answer names the month', async () => {
  let answerAverages: (value: unknown) => void = () => undefined;
  api.GET.mockImplementation((path: string) =>
    path === listPath
      ? ok({ items: [rating('01', 'December comment')], next_cursor: null, month: '2026-12' })
      : new Promise((resolve) => {
          answerAverages = resolve;
        }),
  );
  renderPage();
  expect(monthField().value).toBe('');
  expect(monthField().disabled).toBe(true);
  expect(callsTo(listPath)).toHaveLength(0);
  answerAverages({ data: { items: averageRows, month: '2026-12' }, response: { status: 200, ok: true } });
  expect(await screen.findByText('December comment')).toBeTruthy();
  expect(monthField().value).toBe('2026-12');
  expect(callsTo(listPath)).toHaveLength(1);
});

it('keeps asking later pages and later choices for a month the user or the page named', async () => {
  api.GET.mockImplementation((path: string, init: Init) => {
    if (path !== listPath)
      return ok({ items: averageRows, month: init.params.query.month ?? '2026-12' });
    return init.params.query.cursor
      ? ok({ items: [rating('02', 'Second page')], next_cursor: null, month: '2026-12' })
      : ok({ items: [rating('01', 'First page')], next_cursor: 'c2', month: '2026-12' });
  });
  renderPage();
  await screen.findByText('First page');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'ratings.loadMore') }));
  expect(await screen.findByText('Second page')).toBeTruthy();
  expect((callsTo(listPath)[1]?.[1] as Init).params.query).toMatchObject({
    cursor: 'c2',
    month: '2026-12',
  });
  fireEvent.change(monthField(), { target: { value: '2026-10' } });
  await waitFor(() =>
    expect(
      callsTo(averagesPath).some(([, init]) => (init as Init).params.query.month === '2026-10'),
    ).toBe(true),
  );
  expect(monthField().value).toBe('2026-10');
});
