import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { EmployeeDocumentsSection } from '../ui/employee-documents-section';
import { useEmployeeDocuments } from './use-employee-documents';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const id = '01920000-0000-7000-8000-0000000000a2';
const fileId = '01920000-0000-7000-8000-0000000000f9';
const prefix = ['employee-documents', id, id, id, id];
const document = {
  id,
  employee_id: id,
  type_code: 'civil_id',
  type_name_en: 'Civil ID',
  type_name_ar: null,
  object_key: 'synthetic/verified',
  expires_on: '2026-10-20',
  uploaded_by: id,
  recorded_at: '2026-10-04T08:00:00.000Z',
  status: 'EXPIRING',
};
const view = (canManage: boolean) => ({
  today: '2026-10-05',
  items: [document],
  can_manage: canManage,
  types: [
    {
      id,
      code: 'civil_id',
      name_en: 'Civil ID',
      name_ar: 'Synthetic',
      alert_days: 30,
      requires_expiry: true,
      active: true,
      revision: 1,
    },
  ],
});

it('suppresses a completed upload success after write access is revoked during its refresh', async () => {
  let refreshStarted = false;
  let resolveRefresh!: (value: { data: ReturnType<typeof view> }) => void;
  const refresh = new Promise<{ data: ReturnType<typeof view> }>((resolve) => {
    resolveRefresh = resolve;
  });
  api.GET.mockImplementation(async (path: string) => {
    if (path === '/v1/files/{id}')
      return {
        data: { id: fileId, status: 'READY', content_type: 'application/pdf', size_bytes: 3 },
      };
    return refreshStarted ? refresh : { data: view(true) };
  });
  api.POST.mockImplementation(async (path: string) => {
    if (path === '/v1/businesses/{businessId}/files/uploads')
      return {
        data: {
          id: fileId,
          upload_url: 'https://storage.test/upload',
          expires_in: 120,
          headers: { 'content-type': 'application/pdf', 'content-length': '3' },
        },
      };
    if (path === '/v1/files/{id}/confirm') return { data: { id: fileId, status: 'QUEUED' } };
    refreshStarted = true;
    return { data: document };
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <EmployeeDocumentsSection companyId={id} businessId={id} userId={id} employeeId={id} />
    </QueryClientProvider>,
  );
  fireEvent.change(await screen.findByLabelText(t('en', 'employeeDocuments.file')), {
    target: { files: [new File(['pdf'], 'civil.pdf', { type: 'application/pdf' })] },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'employeeDocuments.expiresOn')), {
    target: { value: '2026-10-20' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'employeeDocuments.upload') }));
  await waitFor(() => expect(client.isFetching({ queryKey: prefix })).toBe(1));
  await act(async () => resolveRefresh({ data: view(false) }));
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(screen.queryByText(t('en', 'employeeDocuments.recorded'))).toBeNull();
  expect(screen.queryByLabelText(t('en', 'employeeDocuments.file'))).toBeNull();
  act(() => client.setQueryData(prefix, view(true)));
  expect(await screen.findByLabelText(t('en', 'employeeDocuments.file'))).toBeTruthy();
  expect(screen.queryByText(t('en', 'employeeDocuments.recorded'))).toBeNull();
});

type OpenCallback = (storageKey: string) => void;
function HookButton({ retain }: { retain: (callback: OpenCallback) => void }) {
  const documents = useEmployeeDocuments(id, id, id, id);
  retain(documents.open.mutate);
  return (
    <button
      disabled={!documents.view.isFetchedAfterMount}
      onClick={() => documents.open.mutate('synthetic/verified')}
    >
      {t('en', 'employeeDocuments.open')}
    </button>
  );
}
function popup() {
  return {
    opener: window as unknown,
    closed: false,
    location: { assign: vi.fn() },
    close: vi.fn(),
  } as unknown as Window;
}
function renderHookButton(client: QueryClient, strict: boolean) {
  const callbacks: OpenCallback[] = [];
  const button = <HookButton retain={(callback) => callbacks.push(callback)} />;
  render(
    <QueryClientProvider client={client}>
      {strict ? <StrictMode>{button}</StrictMode> : button}
    </QueryClientProvider>,
  );
  return callbacks;
}

it('rejects cached authority before this mount completes a successful read', async () => {
  const client = new QueryClient();
  client.setQueryData(prefix, view(true));
  let finish!: (value: { data: ReturnType<typeof view> }) => void;
  api.GET.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  api.POST.mockResolvedValue({
    data: { download_url: 'https://storage.test/private', expires_in: 60 },
  });
  const opened = vi.spyOn(window, 'open').mockImplementation(popup);
  const callbacks = renderHookButton(client, false);
  act(() => callbacks[0]?.('synthetic/verified'));
  expect(opened).not.toHaveBeenCalled();
  expect(api.POST).not.toHaveBeenCalled();
  await act(async () => finish({ data: view(true) }));
  const button = await screen.findByRole('button', { name: t('en', 'employeeDocuments.open') });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(api.POST).toHaveBeenCalledOnce());
  expect(opened).toHaveBeenCalledOnce();
});

it('does not let a retained StrictMode callback borrow the fresh lifetime', async () => {
  api.GET.mockResolvedValue({ data: view(true) });
  api.POST.mockResolvedValue({
    data: { download_url: 'https://storage.test/private', expires_in: 60 },
  });
  const opened = vi.spyOn(window, 'open').mockImplementation(popup);
  const callbacks = renderHookButton(new QueryClient(), true);
  const button = await screen.findByRole('button', { name: t('en', 'employeeDocuments.open') });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  expect(callbacks.length).toBeGreaterThan(1);
  act(() => callbacks[0]?.('synthetic/verified'));
  expect(opened).not.toHaveBeenCalled();
  expect(api.POST).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() => expect(api.POST).toHaveBeenCalledOnce());
  expect(opened).toHaveBeenCalledOnce();
});

it('coalesces two public callbacks in one turn and drops a revoked token before POST', async () => {
  api.GET.mockResolvedValue({ data: view(true) });
  api.POST.mockResolvedValue({
    data: { download_url: 'https://storage.test/private', expires_in: 60 },
  });
  const client = new QueryClient();
  const opened = vi.spyOn(window, 'open').mockImplementation(popup);
  const callbacks = renderHookButton(client, false);
  const button = await screen.findByRole('button', { name: t('en', 'employeeDocuments.open') });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  const current = callbacks.at(-1);
  act(() => {
    current?.('synthetic/verified');
    current?.('synthetic/verified');
  });
  expect(opened).toHaveBeenCalledOnce();
  await waitFor(() => expect(api.POST).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(client.getMutationCache().getAll().at(-1)?.state.status).toBe('success'),
  );
  opened.mockClear();
  api.POST.mockClear();
  act(() => {
    current?.('synthetic/verified');
    const handle = opened.mock.results.at(-1)?.value as { closed: boolean } | undefined;
    if (handle) handle.closed = true;
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(api.POST).not.toHaveBeenCalled();
  const handle = opened.mock.results.at(-1)?.value as
    { closed: boolean; location: { assign: ReturnType<typeof vi.fn> } } | undefined;
  expect(handle?.closed).toBe(true);
  expect(handle?.location.assign).not.toHaveBeenCalled();
  const mutation = client.getMutationCache().getAll().at(-1);
  expect(mutation?.state.data).toBeUndefined();
  expect(JSON.stringify(mutation?.state.error ?? {})).not.toContain('storage.test');
});
