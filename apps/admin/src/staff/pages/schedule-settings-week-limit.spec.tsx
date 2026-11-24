import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ScheduleSettingsPage } from './schedule-settings-page';
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
const day = '2026-10-03';

function weekRead(limit: number) {
  return {
    data: {
      max_shifts_per_day: limit,
      week_start: day,
      timezone: 'Asia/Kuwait',
      days: [
        day,
        '2026-10-04',
        '2026-10-05',
        '2026-10-06',
        '2026-10-07',
        '2026-10-08',
        '2026-10-09',
      ],
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

function settingsRead(limit: number) {
  return {
    data: { business_id: id, max_shifts_per_day: limit, is_default: limit === 3, updated_at: null },
    response: { status: 200, ok: true },
  };
}

function workspacesRead() {
  return {
    data: {
      companies: [
        {
          id,
          name_ar: null,
          name_en: 'Synthetic company',
          role_code: 'owner',
          scope: 'COMPANY',
          businesses: [{ id, name_ar: null, name_en: 'Synthetic business', branches: [] }],
        },
      ],
    },
    response: { status: 200, ok: true },
  };
}

// حالة الخادم: الحد المحفوظ هو ما ترجعله قراية الأسبوع بعد الحفظ.
let savedLimit = 3;

beforeEach(() => {
  savedLimit = 3;
  api.GET.mockReset();
  api.PUT.mockReset();
  api.GET.mockImplementation((path: string) =>
    Promise.resolve(
      path === '/v1/businesses/{businessId}/schedule-settings'
        ? settingsRead(savedLimit)
        : path === '/v1/businesses/{businessId}/branches/{branchId}/schedules'
          ? weekRead(savedLimit)
          : workspacesRead(),
    ),
  );
  api.PUT.mockImplementation((_path: string, options: { body: { max_shifts_per_day: number } }) => {
    savedLimit = options.body.max_shifts_per_day;
    return Promise.resolve({
      data: { business_id: id, max_shifts_per_day: savedLimit, is_default: false, updated_at: null },
      response: { status: 200 },
    });
  });
});

it('uses the limit saved on the settings page in the weekly grid', async () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 30_000 },
      mutations: { retry: false },
    },
  });
  const schedules = render(
    <QueryClientProvider client={client}>
      <SchedulesPage scope={scope} branch={branch} />
    </QueryClientProvider>,
  );
  await screen.findByText('Synthetic employee');
  schedules.unmount();

  const settings = render(
    <QueryClientProvider client={client}>
      <ScheduleSettingsPage scope={scope} />
    </QueryClientProvider>,
  );
  const input = (await screen.findByLabelText(t('en', 'shell.schedule_settings_limit'))) as
    | HTMLInputElement
    | undefined;
  if (input === undefined) throw new Error('Missing the schedule limit field');
  fireEvent.change(input, { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'shell.schedule_settings_save') }));
  await waitFor(() => expect(api.PUT).toHaveBeenCalledOnce());
  settings.unmount();

  const weekly = render(
    <QueryClientProvider client={client}>
      <SchedulesPage scope={scope} branch={branch} />
    </QueryClientProvider>,
  );
  await screen.findByText('Synthetic employee');
  fireEvent.click(
    screen.getByRole('button', { name: `${t('en', 'shell.schedule_edit')} Synthetic employee ${day}` }),
  );
  const add = await screen.findByRole('button', { name: t('en', 'shell.schedule_add') });
  for (let index = 0; index < 3; index += 1) {
    expect((add as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(add);
  }
  expect((add as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(add);
  expect((add as HTMLButtonElement).disabled).toBe(true);
  weekly.unmount();
});
