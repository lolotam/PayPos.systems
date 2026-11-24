import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ScheduleSettingsPage } from './schedule-settings-page';

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const id = '01920000-0000-7000-8000-000000000101';
const otherBranchId = '01920000-0000-7000-8000-000000000102';
const scope = { companyId: id, businessId: id, branchId: id, userId: id };
const title = t('en', 'shell.schedule_settings_title');
const limitLabel = t('en', 'shell.schedule_settings_limit');
const branchLimitLabel = t('en', 'shell.schedule_settings_branch_limit');
const effectiveText = (limit: number) =>
  t('en', 'shell.schedule_settings_effective').replace('{limit}', String(limit));

let savedLimit = 3;
let savedBranchLimits: Record<string, number> = {};
let savedBranchSources: Record<string, 'branch' | 'business'> = {};
let failNextSettingsRead = false;

function answerRead(path: string) {
  if (path === '/v1/businesses/{businessId}/schedule-settings') {
    return {
      data: {
        business_id: id,
        max_shifts_per_day: savedLimit,
        is_default: savedLimit === 3,
        updated_at: null,
        // الفرعان بنفس الحد المحفوظ، عشان تتبان حالة "القيمة الجديدة زي القديمة".
        branches: [
          {
            branch_id: id,
            max_shifts_per_day: savedBranchLimits[id],
            source: savedBranchSources[id],
            updated_at: null,
          },
          {
            branch_id: otherBranchId,
            max_shifts_per_day: savedBranchLimits[otherBranchId],
            source: savedBranchSources[otherBranchId],
            updated_at: null,
          },
        ],
      },
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
  const page = (nextScope: typeof scope) => (
    <QueryClientProvider client={client}>
      <ScheduleSettingsPage scope={nextScope} />
    </QueryClientProvider>
  );
  const view = render(page(scope));
  return {
    client,
    ...view,
    rerenderPage(nextScope: typeof scope) {
      view.rerender(page(nextScope));
    },
    refreshSettings() {
      return client.invalidateQueries({ queryKey: ['schedule-settings', id, id, id] });
    },
  };
}

function answerGet(path: string) {
  if (path === '/v1/businesses/{businessId}/schedule-settings' && failNextSettingsRead) {
    failNextSettingsRead = false;
    return Promise.resolve({
      error: { code: 'INTERNAL' },
      response: { status: 500, ok: false },
    });
  }
  return Promise.resolve(answerRead(path));
}

function answerWrite(
  path: string,
  options: { body: { max_shifts_per_day: number }; params: { path: { branchId: string } } },
) {
  const max = options.body.max_shifts_per_day;
  if (path.includes('/branches/')) {
    const branchId = options.params.path.branchId;
    savedBranchLimits[branchId] = max;
    savedBranchSources[branchId] = 'branch';
    return Promise.resolve({
      data: { branch_id: branchId, max_shifts_per_day: max, source: 'branch', updated_at: null },
      response: { status: 200 },
    });
  }
  savedLimit = max;
  return Promise.resolve({
    data: {
      business_id: id,
      max_shifts_per_day: savedLimit,
      is_default: false,
      updated_at: null,
    },
    response: { status: 200 },
  });
}

function answerDelete(_path: string, options: { params: { path: { branchId: string } } }) {
  const branchId = options.params.path.branchId;
  savedBranchLimits[branchId] = savedLimit;
  savedBranchSources[branchId] = 'business';
  return Promise.resolve({
    data: {
      branch_id: branchId,
      max_shifts_per_day: savedLimit,
      source: 'business',
      updated_at: null,
    },
    response: { status: 200 },
  });
}

function branchButton(key: 'shell.schedule_settings_branch_save' | 'shell.schedule_settings_inherit') {
  return screen.getByRole('button', { name: t('en', key) }) as HTMLButtonElement;
}

beforeEach(() => {
  savedLimit = 3;
  savedBranchLimits = { [id]: 3, [otherBranchId]: 3 };
  savedBranchSources = { [id]: 'branch', [otherBranchId]: 'branch' };
  failNextSettingsRead = false;
  api.GET.mockReset();
  api.PUT.mockReset();
  api.DELETE.mockReset();
  api.GET.mockImplementation(answerGet);
  api.PUT.mockImplementation(answerWrite);
  api.DELETE.mockImplementation(answerDelete);
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
  await waitFor(() =>
    expect((screen.getByLabelText(limitLabel) as HTMLInputElement).value).toBe('4'),
  );
  expect(
    (screen.getByRole('button', { name: t('en', 'shell.schedule_settings_save') }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});

it('shows loading while the read is pending', async () => {
  api.GET.mockImplementation((path: string) =>
    path === '/v1/businesses/{businessId}/schedule-settings'
      ? new Promise(() => undefined)
      : Promise.resolve(answerRead(path)),
  );
  renderPage();
  expect((await screen.findByRole('status')).textContent).toContain(t('en', 'admin.loading'));
});

it('shows the refusal when the read is forbidden', async () => {
  api.GET.mockImplementation((path: string) =>
    path === '/v1/businesses/{businessId}/schedule-settings'
      ? Promise.resolve({
          error: { code: 'FORBIDDEN' },
          response: { status: 403, ok: false },
        })
      : Promise.resolve(answerRead(path)),
  );
  renderPage();
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain(t('en', 'errors.FORBIDDEN'));
  expect(screen.queryByLabelText(limitLabel)).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'shell.schedule_settings_save') })).toBeNull();
  expect(screen.getByRole('heading', { name: title })).toBeTruthy();
});

it('keeps the business draft and shows the saved branch number after another branch is picked', async () => {
  const view = renderPage();
  const businessInput = (await screen.findByLabelText(limitLabel)) as HTMLInputElement;
  const branchInput = (await screen.findByLabelText(branchLimitLabel)) as HTMLInputElement;
  expect(branchInput.value).toBe('3');
  fireEvent.change(businessInput, { target: { value: '4' } });
  fireEvent.change(branchInput, { target: { value: '2' } });

  view.rerenderPage({ ...scope, branchId: otherBranchId });

  expect((screen.getByLabelText(limitLabel) as HTMLInputElement).value).toBe('4');
  expect((screen.getByLabelText(branchLimitLabel) as HTMLInputElement).value).toBe('3');
});

it('saves the branch number of the picked branch and never the number typed for another branch', async () => {
  const view = renderPage();
  const branchInput = (await screen.findByLabelText(branchLimitLabel)) as HTMLInputElement;
  fireEvent.change(branchInput, { target: { value: '2' } });

  view.rerenderPage({ ...scope, branchId: otherBranchId });

  expect((screen.getByLabelText(branchLimitLabel) as HTMLInputElement).value).toBe('3');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'shell.schedule_settings_branch_save') }));
  await waitFor(() =>
    expect(api.PUT).toHaveBeenCalledWith(
      '/v1/businesses/{businessId}/branches/{branchId}/schedule-settings',
      expect.objectContaining({
        params: {
          header: { 'x-company-id': id },
          path: { businessId: id, branchId: otherBranchId },
        },
        body: { max_shifts_per_day: 3 },
      }),
    ),
  );
  expect(api.PUT).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ body: { max_shifts_per_day: 2 } }),
  );
});

it('saves the branch number of the selected branch and shows the saved number after the re-read', async () => {
  renderPage();
  const branchInput = (await screen.findByLabelText(branchLimitLabel)) as HTMLInputElement;
  expect(branchInput.value).toBe('3');
  fireEvent.change(branchInput, { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'shell.schedule_settings_branch_save') }));
  await waitFor(() =>
    expect(api.PUT).toHaveBeenCalledWith(
      '/v1/businesses/{businessId}/branches/{branchId}/schedule-settings',
      expect.objectContaining({
        params: { header: { 'x-company-id': id }, path: { businessId: id, branchId: id } },
        body: { max_shifts_per_day: 2 },
      }),
    ),
  );
  await waitFor(() => expect(screen.getByText(effectiveText(2))).toBeTruthy());
  await waitFor(() => expect(branchButton('shell.schedule_settings_branch_save').disabled).toBe(false));
  expect((screen.getByLabelText(branchLimitLabel) as HTMLInputElement).value).toBe('2');
});

it('shows the saved number of the picked branch when the two branches have different numbers', async () => {
  savedBranchLimits = { [id]: 3, [otherBranchId]: 2 };
  const view = renderPage();
  const branchInput = (await screen.findByLabelText(branchLimitLabel)) as HTMLInputElement;
  expect(branchInput.value).toBe('3');
  fireEvent.change(branchInput, { target: { value: '4' } });

  view.rerenderPage({ ...scope, branchId: otherBranchId });

  await waitFor(() =>
    expect((screen.getByLabelText(branchLimitLabel) as HTMLInputElement).value).toBe('2'),
  );
  expect(screen.getByText(effectiveText(2))).toBeTruthy();
});

it('goes back to the business number for the branch and stops offering the inherit button', async () => {
  renderPage();
  const branchInput = (await screen.findByLabelText(branchLimitLabel)) as HTMLInputElement;
  fireEvent.change(branchInput, { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'shell.schedule_settings_branch_save') }));
  await waitFor(() => expect(screen.getByText(effectiveText(2))).toBeTruthy());
  await waitFor(() => expect(branchButton('shell.schedule_settings_inherit').disabled).toBe(false));

  fireEvent.click(screen.getByRole('button', { name: t('en', 'shell.schedule_settings_inherit') }));
  await waitFor(() =>
    expect(api.DELETE).toHaveBeenCalledWith(
      '/v1/businesses/{businessId}/branches/{branchId}/schedule-settings',
      { params: { header: { 'x-company-id': id }, path: { businessId: id, branchId: id } } },
    ),
  );
  await waitFor(() => expect(screen.getByText(effectiveText(3))).toBeTruthy());
  await waitFor(() => expect(branchButton('shell.schedule_settings_branch_save').disabled).toBe(false));
  expect(branchButton('shell.schedule_settings_inherit').disabled).toBe(true);
});

it('keeps both drafts when a periodic read fails and the next read succeeds', async () => {
  const view = renderPage();
  const businessInput = (await screen.findByLabelText(limitLabel)) as HTMLInputElement;
  const branchInput = (await screen.findByLabelText(branchLimitLabel)) as HTMLInputElement;
  fireEvent.change(businessInput, { target: { value: '4' } });
  fireEvent.change(branchInput, { target: { value: '2' } });

  failNextSettingsRead = true;
  await view.refreshSettings();
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain(t('en', 'admin.unexpected'));

  await view.refreshSettings();
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect((screen.getByLabelText(limitLabel) as HTMLInputElement).value).toBe('4');
  expect((screen.getByLabelText(branchLimitLabel) as HTMLInputElement).value).toBe('2');
});
