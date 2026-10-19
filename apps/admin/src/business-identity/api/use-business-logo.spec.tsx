import type { ReactNode } from 'react';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { identityFailureMessage } from '../model/identity-failure';
import { useBusinessLogo } from './use-business-logo';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PUT: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));

const id = '01920000-0000-7000-8000-0000000000a2';
const fileId = '01920000-0000-7000-8000-0000000000f1';
const png = () => new File(['png'], 'logo.png', { type: 'image/png' });
const ticket = {
  id: fileId,
  upload_url: 'https://storage.test/upload',
  expires_in: 120,
  headers: {
    'content-type': 'image/png',
    'content-length': '3',
    'x-amz-meta-added-later': 'signed',
    host: 'storage.test',
  },
};
const ready = {
  id: fileId,
  status: 'READY',
  content_type: 'image/png',
  size_bytes: 3,
  storage_key: 'tenants/logo',
};

function renderLogo() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const hook = renderHook(() => useBusinessLogo(id, id, id), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return { client, ...hook };
}

beforeEach(() => {
  api.GET.mockReset();
  api.POST.mockReset();
  api.PUT.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
});

it('uploads, shows verifying, then binds only after the file is ready', async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  api.POST.mockImplementation(async (path: string) => {
    if (path === '/v1/businesses/{businessId}/files/uploads') return { data: ticket };
    if (path === '/v1/files/{id}/confirm') return { data: { id: fileId, status: 'QUEUED' } };
    throw new Error(path);
  });
  api.GET.mockImplementation(async () => {
    await gate;
    return { data: ready };
  });
  api.PUT.mockResolvedValue({ data: { logo_file_id: fileId } });
  const { result, client } = renderLogo();
  client.setQueryData(['business-settings', id, id, id], { logo_file_id: null });
  act(() => {
    void result.current.upload.mutate(png());
  });
  await waitFor(() => expect(result.current.phase).toBe('verifying'));
  expect(api.PUT).not.toHaveBeenCalled();
  release();
  await waitFor(() => expect(result.current.phase).toBe('ready'));
  expect(api.POST.mock.calls[0]?.[1].body).toMatchObject({
    owner_module: 'settings',
    owner_entity_id: id,
    required_permission: 'read:settings:business',
  });
  expect(api.PUT).toHaveBeenCalledWith(
    '/v1/businesses/{businessId}/settings/logo',
    expect.objectContaining({ body: { file_id: fileId } }),
  );
  const fetchPut = vi.mocked(fetch);
  expect(fetchPut).toHaveBeenCalledWith(
    'https://storage.test/upload',
    expect.objectContaining({
      method: 'PUT',
      headers: { 'content-type': 'image/png', 'x-amz-meta-added-later': 'signed' },
    }),
  );
  expect(client.getQueryData(['business-settings', id, id, id])).toMatchObject({
    logo_file_id: fileId,
  });
});

it('does not bind a rejected upload', async () => {
  api.POST.mockImplementation(async (path: string) =>
    path === '/v1/files/{id}/confirm'
      ? { data: { id: fileId, status: 'QUEUED' } }
      : { data: ticket },
  );
  api.GET.mockResolvedValue({
    data: { ...ready, status: 'REJECTED', rejection_code: 'FILE_CONTENT_INVALID' },
  });
  const { result } = renderLogo();
  await act(async () => {
    await result.current.upload.mutateAsync(png()).catch(() => undefined);
  });
  expect(result.current.phase).toBe('rejected');
  expect(identityFailureMessage(result.current.failure, 'en')).toBe(
    t('en', 'errors.FILE_CONTENT_INVALID'),
  );
  expect(api.PUT).not.toHaveBeenCalled();
});

it('maps a forbidden upload to the bilingual forbidden message', async () => {
  api.POST.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  const { result, client } = renderLogo();
  client.setQueryData(['business-identity-access', id, id, id], true);
  await act(async () => {
    await result.current.upload.mutateAsync(png()).catch(() => undefined);
  });
  expect(identityFailureMessage(result.current.failure, 'en')).toBe(t('en', 'errors.FORBIDDEN'));
  expect(api.PUT).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(client.getQueryState(['business-identity-access', id, id, id])?.isInvalidated).toBe(true);
});

it('invalidates identity capability when removing the logo is forbidden', async () => {
  api.PUT.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  const { result, client } = renderLogo();
  client.setQueryData(['business-identity-access', id, id, id], true);
  await act(async () => {
    await result.current.remove.mutateAsync().catch(() => undefined);
  });
  expect(client.getQueryState(['business-identity-access', id, id, id])?.isInvalidated).toBe(true);
});

it('removes the logo by putting a null file id', async () => {
  api.PUT.mockResolvedValue({ data: { logo_file_id: null } });
  const { result, client } = renderLogo();
  client.setQueryData(['business-settings', id, id, id], { logo_file_id: fileId });
  await act(async () => {
    await result.current.remove.mutateAsync();
  });
  expect(api.PUT).toHaveBeenCalledWith(
    '/v1/businesses/{businessId}/settings/logo',
    expect.objectContaining({ body: { file_id: null } }),
  );
  expect(result.current.removed).toBe(true);
  expect(result.current.writtenId).toBeNull();
  expect(client.getQueryData(['business-settings', id, id, id])).toMatchObject({
    logo_file_id: null,
  });
});

const fileB = '01920000-0000-7000-8000-0000000000f2';

it('does not bind an upload that was left behind when a newer one finishes', async () => {
  let releaseA = () => {};
  const gateA = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  const uploads: string[] = [];
  api.POST.mockImplementation(async (path: string) => {
    if (path !== '/v1/businesses/{businessId}/files/uploads') {
      return { data: { id: fileId, status: 'QUEUED' } };
    }
    const file = uploads.length === 0 ? fileId : fileB;
    uploads.push(file);
    return { data: { ...ticket, id: file } };
  });
  api.GET.mockImplementation(async (_path: string, init: { params: { path: { id: string } } }) => {
    if (init.params.path.id === fileId) {
      await gateA;
      return { data: ready };
    }
    return { data: { ...ready, id: fileB } };
  });
  api.PUT.mockImplementation(async (_path: string, init: { body: { file_id: string } }) => ({
    data: { logo_file_id: init.body.file_id },
  }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const first = renderHook(() => useBusinessLogo(id, id, id), { wrapper });
  const pendingA = first.result.current.upload.mutateAsync(png()).catch(() => undefined);
  await waitFor(() => expect(first.result.current.phase).toBe('verifying'));
  first.unmount();
  await pendingA;
  const second = renderHook(() => useBusinessLogo(id, id, id), { wrapper });
  await act(async () => {
    await second.result.current.upload.mutateAsync(png());
  });
  expect(api.PUT).toHaveBeenCalledTimes(1);
  expect(api.PUT.mock.calls[0]?.[1].body).toEqual({ file_id: fileB });
  expect(second.result.current.writtenId).toBe(fileB);
  releaseA();
  await act(async () => {
    await Promise.resolve();
  });
  expect(api.PUT).toHaveBeenCalledTimes(1);
  expect(second.result.current.writtenId).toBe(fileB);
});
