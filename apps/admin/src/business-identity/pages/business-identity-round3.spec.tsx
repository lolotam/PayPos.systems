import type { BusinessIdentity, BusinessSettings } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { BusinessIdentityPage } from './business-identity-page';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const id = '01920000-0000-7000-8000-0000000000a2';
const fileId = '01920000-0000-7000-8000-0000000000f1';
const save = t('en', 'businessIdentity.save');
const remove = t('en', 'businessIdentity.remove');
const confirm = t('en', 'businessIdentity.removeConfirm');

function settings(logo: string | null = null, nameEn = 'Shop') {
  return {
    business_id: id,
    default_language: 'en',
    calendar: 'gregorian',
    limit_bps: null,
    tax_rule: null,
    official_name_ar: 'Alpha',
    official_name_en: nameEn,
    logo_file_id: logo,
    overridden: [],
    updated_at: null,
  };
}

beforeEach(() => {
  api.GET.mockReset();
  api.POST.mockReset();
  api.PATCH.mockReset();
  api.PUT.mockReset();
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  const view = render(
    <QueryClientProvider client={client}>
      <BusinessIdentityPage companyId={id} userId={id} businessId={id} />
    </QueryClientProvider>,
  );
  return { client, ...view };
}

function cached<T>(client: QueryClient, key: string) {
  return client.getQueryData<T>([key, id, id, id]);
}

it('keeps a saved name when an older read resolves afterwards', async () => {
  let identityReads = 0;
  let releaseIdentity = () => {};
  let releaseSettings = () => {};
  let settingsStarted = false;
  api.GET.mockImplementation(async (path: string) => {
    if (path !== '/v1/businesses/{businessId}/settings/identity') return { data: settings() };
    identityReads += 1;
    if (identityReads === 1) return { data: settings() };
    if (identityReads === 2) {
      return new Promise((resolve) => {
        releaseIdentity = () => resolve({ data: settings() });
      });
    }
    return { data: settings(null, 'New shop') };
  });
  api.PATCH.mockResolvedValue({
    data: { official_name_ar: 'Alpha', official_name_en: 'New shop' },
  });
  const { client } = renderPage();
  client.setQueryData(['business-settings', id, id, id], settings());
  fireEvent.change(await screen.findByLabelText(t('en', 'businessIdentity.nameEn')), {
    target: { value: 'New shop' },
  });
  const settingsFlight = client
    .fetchQuery({
      queryKey: ['business-settings', id, id, id],
      queryFn: () =>
        new Promise((resolve) => {
          settingsStarted = true;
          releaseSettings = () => resolve(settings());
        }),
    })
    .catch(() => undefined);
  await waitFor(() => expect(settingsStarted).toBe(true));
  void client.invalidateQueries({ queryKey: ['business-identity', id, id, id] });
  await waitFor(() => expect(identityReads).toBe(2));
  fireEvent.click(screen.getByRole('button', { name: save }));
  await screen.findByText(t('en', 'businessIdentity.saved'));
  releaseIdentity();
  releaseSettings();
  await act(async () => {
    await settingsFlight;
  });
  const english = screen.getByLabelText(t('en', 'businessIdentity.nameEn')) as HTMLInputElement;
  expect(english.value).toBe('New shop');
  expect(cached<BusinessIdentity>(client, 'business-identity')?.official_name_en).toBe('New shop');
  expect(cached<BusinessSettings>(client, 'business-settings')?.official_name_en).toBe('New shop');
});

it('shows another admin name after save and does not send that name back', async () => {
  let reads = 0;
  api.GET.mockImplementation(async () => {
    reads += 1;
    const nameEn = reads === 1 ? 'Mine' : 'Theirs';
    const nameAr = reads === 1 ? 'Alpha' : 'Saved ar';
    return { data: { ...settings(), official_name_ar: nameAr, official_name_en: nameEn } };
  });
  api.PATCH.mockResolvedValue({
    data: { official_name_ar: 'Saved ar', official_name_en: 'Mine' },
  });
  renderPage();
  fireEvent.change(await screen.findByLabelText(t('en', 'businessIdentity.nameAr')), {
    target: { value: 'Saved ar' },
  });
  fireEvent.click(screen.getByRole('button', { name: save }));
  await screen.findByText(t('en', 'businessIdentity.saved'));
  await waitFor(() => {
    const english = screen.getByLabelText(t('en', 'businessIdentity.nameEn')) as HTMLInputElement;
    expect(english.value).toBe('Theirs');
  });
  fireEvent.change(screen.getByLabelText(t('en', 'businessIdentity.nameAr')), {
    target: { value: 'Next ar' },
  });
  fireEvent.click(screen.getByRole('button', { name: save }));
  await waitFor(() => expect(api.PATCH).toHaveBeenCalledTimes(2));
  expect(api.PATCH.mock.calls[1]?.[1].body).toEqual({ official_name_ar: 'Next ar' });
});

it('keeps a dirty official name when a refetch changes the other name', async () => {
  let current = settings();
  api.GET.mockImplementation(async () => ({ data: current }));
  const { client } = renderPage();
  const arabic = (await screen.findByLabelText(
    t('en', 'businessIdentity.nameAr'),
  )) as HTMLInputElement;
  fireEvent.change(arabic, { target: { value: 'Draft' } });
  current = settings(null, 'Server');
  await client.invalidateQueries({ queryKey: ['business-identity', id, id, id] });
  await waitFor(() => {
    const english = screen.getByLabelText(t('en', 'businessIdentity.nameEn')) as HTMLInputElement;
    expect(english.value).toBe('Server');
  });
  expect(
    (screen.getByLabelText(t('en', 'businessIdentity.nameAr')) as HTMLInputElement).value,
  ).toBe('Draft');
});

it('offers confirmed removal when the logo id is still unknown', async () => {
  api.GET.mockResolvedValue({ error: { code: 'STORAGE_UNAVAILABLE' }, response: { status: 503 } });
  api.PUT.mockResolvedValue({ data: { logo_file_id: null } });
  renderPage();
  expect((await screen.findByRole('alert')).textContent).toContain(
    t('en', 'errors.STORAGE_UNAVAILABLE'),
  );
  expect(screen.queryByLabelText(t('en', 'businessIdentity.nameEn'))).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByRole('button', { name: t('en', 'businessIdentity.upload') })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: remove }));
  fireEvent.click(screen.getByRole('button', { name: confirm }));
  await waitFor(() => expect(api.PUT).toHaveBeenCalled());
  expect(api.PUT.mock.calls[0]?.[1].body).toEqual({ file_id: null });
});

it('does not offer removal when the business has no logo', async () => {
  api.GET.mockResolvedValue({ data: settings(null) });
  renderPage();
  await screen.findByRole('button', { name: t('en', 'businessIdentity.upload') });
  expect(screen.queryByRole('button', { name: remove })).toBeNull();
});

it('shows a removal failure inside the open confirm dialog', async () => {
  api.GET.mockResolvedValue({ data: settings(fileId) });
  api.POST.mockResolvedValue({ data: { download_url: 'https://files.test/logo', expires_in: 60 } });
  api.PUT.mockResolvedValue({
    error: { code: 'STORAGE_UNAVAILABLE' },
    response: { status: 503 },
  });
  renderPage();
  await screen.findByRole('img', { name: 'Shop' });
  fireEvent.click(screen.getByRole('button', { name: remove }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: confirm }));
  const alert = await within(dialog).findByRole('alert');
  expect(alert.textContent).toContain(t('en', 'errors.STORAGE_UNAVAILABLE'));
  const outside = screen.getAllByRole('alert').filter((node) => !dialog.contains(node));
  expect(outside).toEqual([]);
  expect(screen.queryByText(t('en', 'businessIdentity.removed'))).toBeNull();
});
