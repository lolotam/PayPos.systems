import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { BusinessIdentityPage } from './business-identity-page';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const id = '01920000-0000-7000-8000-0000000000a2';
const storedId = '01920000-0000-7000-8000-0000000000f1';
const mine = '01920000-0000-7000-8000-0000000000f2';
const other = '01920000-0000-7000-8000-0000000000f3';
const upload = t('en', 'businessIdentity.upload');
const remove = t('en', 'businessIdentity.remove');
const confirm = t('en', 'businessIdentity.removeConfirm');

function settings(logo: string | null) {
  return {
    business_id: id,
    default_language: 'en',
    calendar: 'gregorian',
    limit_bps: null,
    tax_rule: null,
    official_name_ar: 'Alpha',
    official_name_en: 'Shop',
    logo_file_id: logo,
    overridden: [],
    updated_at: null,
  };
}

function ticket(file: string) {
  return {
    id: file,
    upload_url: 'https://storage.test/upload',
    expires_in: 120,
    headers: { 'content-type': 'image/png', 'content-length': '3' },
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <BusinessIdentityPage companyId={id} userId={id} businessId={id} />
    </QueryClientProvider>,
  );
  return { client, ...view };
}

function chooseLogo() {
  fireEvent.change(screen.getByLabelText(t('en', 'businessIdentity.logoFile')), {
    target: { files: [new File(['png'], 'logo.png', { type: 'image/png' })] },
  });
}

beforeEach(() => {
  api.GET.mockReset();
  api.POST.mockReset();
  api.PATCH.mockReset();
  api.PUT.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
});

it('keeps a name draft when a background refetch fails and hides it on 403', async () => {
  api.GET.mockResolvedValue({ data: settings(null) });
  const { client } = renderPage();
  const field = (await screen.findByLabelText(
    t('en', 'businessIdentity.nameEn'),
  )) as HTMLInputElement;
  fireEvent.change(field, { target: { value: 'Draft shop' } });
  api.GET.mockRejectedValue(new Error('offline'));
  await client.invalidateQueries({ queryKey: ['business-identity', id, id, id] });
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(
    (screen.getByLabelText(t('en', 'businessIdentity.nameEn')) as HTMLInputElement).value,
  ).toBe('Draft shop');
  api.GET.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  await client.invalidateQueries({ queryKey: ['business-identity', id, id, id] });
  await waitFor(() => {
    expect(screen.queryByLabelText(t('en', 'businessIdentity.nameEn'))).toBeNull();
  });
});

it('shows another admin logo when the refetch after an upload returns it', async () => {
  let shown: string | null = null;
  api.GET.mockImplementation(async (path: string) =>
    path === '/v1/files/{id}'
      ? { data: { id: mine, status: 'READY', content_type: 'image/png', size_bytes: 3 } }
      : { data: settings(shown) },
  );
  api.POST.mockImplementation(async (path: string, init: { params: { path: { id: string } } }) => {
    if (path === '/v1/businesses/{businessId}/files/uploads') return { data: ticket(mine) };
    if (path === '/v1/files/{id}/confirm') return { data: { id: mine, status: 'QUEUED' } };
    return { data: { download_url: `https://files.test/${init.params.path.id}`, expires_in: 60 } };
  });
  api.PUT.mockImplementation(async (_path: string, init: { body: { file_id: string } }) => {
    shown = other;
    return { data: { logo_file_id: init.body.file_id } };
  });
  renderPage();
  await screen.findByRole('button', { name: upload });
  chooseLogo();
  fireEvent.click(screen.getByRole('button', { name: upload }));
  await waitFor(() => {
    expect(screen.getByRole('img', { name: 'Shop' }).getAttribute('src')).toBe(
      `https://files.test/${other}`,
    );
  });
  expect(api.PUT.mock.calls.at(-1)?.[1].body).toEqual({ file_id: mine });
});

it('keeps the removal dialog closed after a successful removal and a new upload', async () => {
  let shown: string | null = storedId;
  api.GET.mockImplementation(async (path: string) =>
    path === '/v1/files/{id}'
      ? { data: { id: mine, status: 'READY', content_type: 'image/png', size_bytes: 3 } }
      : { data: settings(shown) },
  );
  api.POST.mockImplementation(async (path: string, init: { params: { path: { id: string } } }) => {
    if (path === '/v1/businesses/{businessId}/files/uploads') return { data: ticket(mine) };
    if (path === '/v1/files/{id}/confirm') return { data: { id: mine, status: 'QUEUED' } };
    return { data: { download_url: `https://files.test/${init.params.path.id}`, expires_in: 60 } };
  });
  api.PUT.mockImplementation(async (_path: string, init: { body: { file_id: string | null } }) => {
    shown = init.body.file_id;
    return { data: { logo_file_id: init.body.file_id } };
  });
  renderPage();
  await screen.findByRole('img', { name: 'Shop' });
  fireEvent.click(screen.getByRole('button', { name: remove }));
  fireEvent.click(screen.getByRole('button', { name: confirm }));
  await screen.findByText(t('en', 'businessIdentity.removed'));
  chooseLogo();
  fireEvent.click(screen.getByRole('button', { name: upload }));
  await screen.findByText(t('en', 'businessIdentity.ready'));
  expect(screen.getByRole('img', { name: 'Shop' }).getAttribute('src')).toBe(
    `https://files.test/${mine}`,
  );
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('retries a failed identity read and then shows the names', async () => {
  let failing = true;
  api.GET.mockImplementation(async (path: string) => {
    if (path === '/v1/businesses/{businessId}/settings/identity' && failing) {
      return { error: { code: 'INTERNAL_ERROR' }, response: { status: 500 } };
    }
    return { data: settings(null) };
  });
  renderPage();
  const retry = await screen.findByRole('button', { name: t('en', 'pos.retry') });
  expect(screen.queryByLabelText(t('en', 'businessIdentity.nameEn'))).toBeNull();
  failing = false;
  fireEvent.click(retry);
  const english = (await screen.findByLabelText(
    t('en', 'businessIdentity.nameEn'),
  )) as HTMLInputElement;
  expect(english.value).toBe('Shop');
});

it('offers no retry when the identity read is refused', async () => {
  api.GET.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  renderPage();
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: t('en', 'pos.retry') })).toBeNull();
});

it('hides the saved notice as soon as the names are edited again', async () => {
  api.GET.mockResolvedValue({ data: settings(null) });
  api.PATCH.mockResolvedValue({
    data: { official_name_ar: 'Alpha', official_name_en: 'New shop' },
  });
  renderPage();
  const english = await screen.findByLabelText(t('en', 'businessIdentity.nameEn'));
  fireEvent.change(english, { target: { value: 'New shop' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'businessIdentity.save') }));
  await screen.findByText(t('en', 'businessIdentity.saved'));
  fireEvent.change(english, { target: { value: 'Newer shop' } });
  await waitFor(() => expect(screen.queryByText(t('en', 'businessIdentity.saved'))).toBeNull());
});

it('closes the whole editor and rechecks access when the identity read is refused', async () => {
  api.GET.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  const { client } = renderPage();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  await screen.findByRole('alert');
  expect(screen.queryByLabelText(t('en', 'businessIdentity.logoFile'))).toBeNull();
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['business-identity-access', id, id, id],
    }),
  );
});
