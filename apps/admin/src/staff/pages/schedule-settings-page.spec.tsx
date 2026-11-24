import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ScheduleSettingsPage } from './schedule-settings-page';

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const id = '01920000-0000-7000-8000-000000000101';
const scope = { companyId: id, businessId: id, branchId: id, userId: id };
const title = t('en', 'shell.schedule_settings_title');
const limitLabel = t('en', 'shell.schedule_settings_limit');

function answerRead(path: string) {
  if (path === '/v1/businesses/{businessId}/schedule-settings') {
    return {
      data: { business_id: id, max_shifts_per_day: 3, is_default: true, updated_at: null },
      response: { status: 200, ok: true },
    };
  }
  if (path === '/v1/me/workspaces') {
    return {
      data: {
        companies: [
          {
            id,
            name_ar: null,
            name_en: 'Synthetic company',
            role_code: 'owner',
            scope: 'COMPANY',
            businesses: [
              {
                id,
                name_ar: null,
                name_en: 'Synthetic business',
                branches: [{ id, name_ar: null, name_en: 'Synthetic branch' }],
              },
            ],
          },
        ],
      },
      response: { status: 200, ok: true },
    };
  }
  return { data: undefined, response: { status: 404, ok: false } };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <ScheduleSettingsPage scope={scope} />
    </QueryClientProvider>,
  );
  return { client, ...view };
}

beforeEach(() => {
  api.GET.mockReset();
  api.PUT.mockReset();
  api.GET.mockImplementation((path: string) => Promise.resolve(answerRead(path)));
  api.PUT.mockResolvedValue({
    data: { business_id: id, max_shifts_per_day: 4, is_default: false, updated_at: null },
    response: { status: 200 },
  });
});

it('puts the settings in the form shell under one header', async () => {
  renderPage();
  const heading = await screen.findByRole('heading', { name: title });
  expect(heading.tagName).toBe('H1');
  expect(screen.getAllByRole('heading', { name: title })).toHaveLength(1);
  expect(heading.closest('[data-page-shell]')?.getAttribute('data-page-shell')).toBe('form');
  expect(await screen.findByLabelText(limitLabel)).toBeTruthy();
});

it('saves the business limit from this page', async () => {
  renderPage();
  const input = (await screen.findByLabelText(limitLabel)) as HTMLInputElement;
  fireEvent.change(input, { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'shell.schedule_settings_save') }));
  await waitFor(() =>
    expect(api.PUT).toHaveBeenCalledWith(
      '/v1/businesses/{businessId}/schedule-settings',
      expect.objectContaining({
        params: { header: { 'x-company-id': id }, path: { businessId: id } },
        body: { max_shifts_per_day: 4 },
      }),
    ),
  );
});

it('hides the settings when the read is refused', async () => {
  api.GET.mockImplementation((path: string) =>
    path === '/v1/businesses/{businessId}/schedule-settings'
      ? Promise.resolve({
          error: { code: 'FORBIDDEN' },
          response: { status: 403, ok: false },
        })
      : Promise.resolve(answerRead(path)),
  );
  renderPage();
  await waitFor(() => expect(screen.queryByLabelText(limitLabel)).toBeNull());
  expect(screen.getByRole('heading', { name: title })).toBeTruthy();
});
