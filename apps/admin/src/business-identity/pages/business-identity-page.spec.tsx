import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { BusinessIdentityPage } from './business-identity-page';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const id = '01920000-0000-7000-8000-0000000000a2';
const fileId = '01920000-0000-7000-8000-0000000000f1';
const nextId = '01920000-0000-7000-8000-0000000000f2';
const save = t('en', 'businessIdentity.save');

function settings(logo: string | null = null) {
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

it('saves only the changed official name and refreshes the identity read', async () => {
  api.GET.mockResolvedValue({ data: settings() });
  api.PATCH.mockResolvedValue({
    data: { official_name_ar: 'Alpha', official_name_en: 'New shop' },
  });
  const { client } = renderPage();
  client.setQueryData(['business-settings', id, id, id], settings());
  fireEvent.change(await screen.findByLabelText(t('en', 'businessIdentity.nameEn')), {
    target: { value: 'New shop' },
  });
  fireEvent.click(screen.getByRole('button', { name: save }));
  await screen.findByText(t('en', 'businessIdentity.saved'));
  expect(api.PATCH.mock.calls[0]?.[1].body).toEqual({ official_name_en: 'New shop' });
  expect(client.getQueryData(['business-settings', id, id, id])).toMatchObject({
    official_name_en: 'New shop',
    official_name_ar: 'Alpha',
  });
  await waitFor(() => {
    const reads = api.GET.mock.calls.filter(
      (call) => call[0] === '/v1/businesses/{businessId}/settings/identity',
    );
    expect(reads.length).toBeGreaterThan(1);
  });
  expect(api.GET.mock.calls.map((call) => call[0])).not.toContain(
    '/v1/businesses/{businessId}/settings',
  );
});

it('sends null when a saved name is cleared', async () => {
  api.GET.mockResolvedValue({ data: settings() });
  api.PATCH.mockResolvedValue({ data: { official_name_ar: null, official_name_en: 'Shop' } });
  renderPage();
  fireEvent.change(await screen.findByLabelText(t('en', 'businessIdentity.nameAr')), {
    target: { value: '' },
  });
  fireEvent.click(screen.getByRole('button', { name: save }));
  await waitFor(() => expect(api.PATCH).toHaveBeenCalled());
  expect(api.PATCH.mock.calls[0]?.[1].body).toEqual({ official_name_ar: null });
});

it('does not patch a name that was edited back to the saved value', async () => {
  api.GET.mockResolvedValue({ data: settings() });
  renderPage();
  const field = await screen.findByLabelText(t('en', 'businessIdentity.nameEn'));
  fireEvent.change(field, { target: { value: 'Shop x' } });
  fireEvent.change(field, { target: { value: 'Shop' } });
  fireEvent.click(screen.getByRole('button', { name: save }));
  expect(await screen.findByText(t('en', 'businessIdentity.unchanged'))).toBeTruthy();
  expect(api.PATCH).not.toHaveBeenCalled();
});

it('hides the editor when the identity read is refused', async () => {
  api.GET.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  renderPage();
  expect((await screen.findByRole('alert')).textContent).toContain(t('en', 'errors.FORBIDDEN'));
  expect(screen.queryByLabelText(t('en', 'businessIdentity.nameEn'))).toBeNull();
  expect(api.PATCH).not.toHaveBeenCalled();
});

it('shows stored names and the logo when settings read is refused', async () => {
  let logo: string | null = fileId;
  api.GET.mockImplementation(async (path: string) => {
    if (path === '/v1/businesses/{businessId}/settings') {
      return { error: { code: 'FORBIDDEN' }, response: { status: 403 } };
    }
    if (path === '/v1/files/{id}') {
      return { data: { id: nextId, status: 'READY', content_type: 'image/png', size_bytes: 3 } };
    }
    return { data: settings(logo) };
  });
  api.POST.mockImplementation(async (path: string) => {
    if (path === '/v1/files/{id}/download') {
      return { data: { download_url: 'https://files.test/logo', expires_in: 60 } };
    }
    if (path === '/v1/files/{id}/confirm') return { data: { id: nextId, status: 'QUEUED' } };
    return { data: ticket(nextId) };
  });
  api.PUT.mockImplementation(async (_path: string, init: { body: { file_id: string | null } }) => {
    logo = init.body.file_id;
    return { data: { logo_file_id: logo } };
  });
  renderPage();
  const english = (await screen.findByLabelText(
    t('en', 'businessIdentity.nameEn'),
  )) as HTMLInputElement;
  expect(english.value).toBe('Shop');
  expect(
    (screen.getByLabelText(t('en', 'businessIdentity.nameAr')) as HTMLInputElement).value,
  ).toBe('Alpha');
  expect((await screen.findByRole('img', { name: 'Shop' })).getAttribute('src')).toBe(
    'https://files.test/logo',
  );
  expect(screen.getByRole('button', { name: t('en', 'businessIdentity.replace') })).toBeTruthy();
  expect(screen.getByRole('button', { name: t('en', 'businessIdentity.remove') })).toBeTruthy();
  expect(api.GET.mock.calls.map((call) => call[0])).not.toContain(
    '/v1/businesses/{businessId}/settings',
  );
  fireEvent.change(screen.getByLabelText(t('en', 'businessIdentity.logoFile')), {
    target: { files: [new File(['png'], 'next.png', { type: 'image/png' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'businessIdentity.replace') }));
  await screen.findByText(t('en', 'businessIdentity.ready'));
  expect(api.PUT.mock.calls.at(-1)?.[1].body).toEqual({ file_id: nextId });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'businessIdentity.remove') }));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'businessIdentity.removeConfirm') }));
  await screen.findByText(t('en', 'businessIdentity.removed'));
  expect(api.PUT.mock.calls.at(-1)?.[1].body).toEqual({ file_id: null });
  expect(screen.queryByRole('img')).toBeNull();
});

it('shows the forbidden message when saving names is refused', async () => {
  api.GET.mockResolvedValue({ data: settings() });
  api.PATCH.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  const { client } = renderPage();
  client.setQueryData(['business-identity-access', id, id, id], true);
  fireEvent.change(await screen.findByLabelText(t('en', 'businessIdentity.nameEn')), {
    target: { value: 'New shop' },
  });
  fireEvent.click(screen.getByRole('button', { name: save }));
  expect((await screen.findByRole('alert')).textContent).toContain(t('en', 'errors.FORBIDDEN'));
  expect(client.getQueryState(['business-identity-access', id, id, id])?.isInvalidated).toBe(true);
});

it('shows a rejected logo and does not bind it', async () => {
  api.GET.mockImplementation(async (path: string) =>
    path === '/v1/files/{id}'
      ? {
          data: {
            id: fileId,
            status: 'REJECTED',
            content_type: 'image/png',
            size_bytes: 3,
            rejection_code: 'FILE_TYPE_INVALID',
          },
        }
      : { data: settings() },
  );
  api.POST.mockImplementation(async (path: string) =>
    path === '/v1/files/{id}/confirm'
      ? { data: { id: fileId, status: 'QUEUED' } }
      : { data: ticket(fileId) },
  );
  renderPage();
  await screen.findByLabelText(t('en', 'businessIdentity.logoFile'));
  fireEvent.change(screen.getByLabelText(t('en', 'businessIdentity.logoFile')), {
    target: { files: [new File(['png'], 'logo.png', { type: 'image/png' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'businessIdentity.upload') }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    t('en', 'errors.FILE_TYPE_INVALID'),
  );
  expect(screen.getByText(t('en', 'businessIdentity.rejected'))).toBeTruthy();
  expect(api.PUT).not.toHaveBeenCalled();
});

it('previews the logo through the audited download and keeps the url out of the query cache', async () => {
  api.GET.mockResolvedValue({ data: settings(fileId) });
  api.POST.mockResolvedValue({ data: { download_url: 'https://files.test/logo', expires_in: 60 } });
  const { client } = renderPage();
  const image = await screen.findByRole('img', { name: 'Shop' });
  expect(image.getAttribute('src')).toBe('https://files.test/logo');
  expect(api.POST.mock.calls.map((call) => call[0])).toEqual(['/v1/files/{id}/download']);
  expect(api.POST.mock.calls[0]?.[1].params.path).toEqual({ id: fileId });
  expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain('https://files.test/logo');
});

it('replaces the logo by binding the new ready file', async () => {
  api.GET.mockImplementation(async (path: string) =>
    path === '/v1/files/{id}'
      ? { data: { id: nextId, status: 'READY', content_type: 'image/png', size_bytes: 3 } }
      : { data: settings(fileId) },
  );
  api.POST.mockImplementation(async (path: string) => {
    if (path === '/v1/businesses/{businessId}/files/uploads') return { data: ticket(nextId) };
    if (path === '/v1/files/{id}/confirm') return { data: { id: nextId, status: 'QUEUED' } };
    return { data: { download_url: 'https://files.test/logo', expires_in: 60 } };
  });
  api.PUT.mockResolvedValue({ data: { logo_file_id: nextId } });
  renderPage();
  await screen.findByRole('button', { name: t('en', 'businessIdentity.replace') });
  fireEvent.change(screen.getByLabelText(t('en', 'businessIdentity.logoFile')), {
    target: { files: [new File(['png'], 'next.png', { type: 'image/png' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'businessIdentity.replace') }));
  await screen.findByText(t('en', 'businessIdentity.ready'));
  const bound = api.PUT.mock.calls.map((call) => call[1].body);
  expect(bound).toEqual([{ file_id: nextId }]);
});

it('removes the logo only after confirmation', async () => {
  let logo: string | null = fileId;
  api.GET.mockImplementation(async () => ({ data: settings(logo) }));
  api.POST.mockResolvedValue({ data: { download_url: 'https://files.test/logo', expires_in: 60 } });
  api.PUT.mockImplementation(async () => {
    logo = null;
    return { data: { logo_file_id: null } };
  });
  renderPage();
  await screen.findByRole('img', { name: 'Shop' });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'businessIdentity.remove') }));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'businessIdentity.cancel') }));
  expect(api.PUT).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'businessIdentity.remove') }));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'businessIdentity.removeConfirm') }));
  await screen.findByText(t('en', 'businessIdentity.removed'));
  expect(api.PUT.mock.calls[0]?.[1].body).toEqual({ file_id: null });
  expect(screen.queryByRole('img')).toBeNull();
});

it('refuses a file the logo contract will not upload', async () => {
  api.GET.mockResolvedValue({ data: settings() });
  renderPage();
  await screen.findByLabelText(t('en', 'businessIdentity.logoFile'));
  fireEvent.change(screen.getByLabelText(t('en', 'businessIdentity.logoFile')), {
    target: { files: [new File(['x'], 'logo.webp', { type: 'image/webp' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'businessIdentity.upload') }));
  expect(await screen.findByText(t('en', 'businessIdentity.invalidFile'))).toBeTruthy();
  expect(api.POST).not.toHaveBeenCalled();
});
