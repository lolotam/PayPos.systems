import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmployeeDocumentsSection } from '../ui/employee-documents-section';
const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
const id = '01920000-0000-7000-8000-0000000000a2';
const other = '01920000-0000-7000-8000-0000000000a3';
const fileId = '01920000-0000-7000-8000-0000000000f9';
const props = { companyId: id, businessId: id, userId: id, employeeId: id };
const prefix = ['employee-documents', id, id, id, id];
const civil = {
  id,
  code: 'civil_id',
  name_en: 'Civil ID',
  name_ar: 'Synthetic civil ID (ar)',
  alert_days: 30,
  requires_expiry: true,
  active: true,
  revision: 1,
};
const passport = {
  ...civil,
  id: other,
  code: 'passport',
  name_en: 'Passport',
  requires_expiry: false,
};
const recordedDocument = {
  id,
  employee_id: id,
  type_code: 'civil_id',
  type_name_en: 'Civil ID',
  type_name_ar: null,
  object_key: 'company/business/key/verified',
  expires_on: '2026-10-20',
  uploaded_by: id,
  recorded_at: '2026-10-04T08:00:00.000Z',
  status: 'EXPIRING',
};
const view = (canManage = true) => ({
  today: '2026-10-05',
  items: [recordedDocument],
  types: [civil],
  can_manage: canManage,
});
const put = vi.fn();
beforeEach(() => {
  api.GET.mockReset();
  api.POST.mockReset();
  put.mockReset();
  vi.stubGlobal('fetch', put);
});
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = render(
    <QueryClientProvider client={client}>
      <EmployeeDocumentsSection {...props} />
    </QueryClientProvider>,
  );
  return { client, ...rendered };
}
const readyFile = {
  data: { id: fileId, status: 'READY', content_type: 'application/pdf', size_bytes: 3 },
};
const privateDownload = {
  data: { download_url: 'https://storage.test/private', expires_in: 60 },
};
const verifying = t('en', 'employeeDocuments.verifying');
const uploading = t('en', 'employeeDocuments.uploading');
const recordPath = '/v1/businesses/{businessId}/employees/{employeeId}/documents';
const openButton = () => screen.getByRole('button', { name: t('en', 'employeeDocuments.open') });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
const settle = <T,>(operation: { resolve: (value: T) => void }, value: T) =>
  act(async () => operation.resolve(value));
const failure = (message_en: string) => ({
  error: { message_en, message_ar: t('ar', 'errors.FORBIDDEN') },
  response: { status: 500 },
});
function mockDocuments(ready: Promise<unknown>, read: () => unknown) {
  api.GET.mockImplementation((path: string) =>
    path === '/v1/files/{id}' ? ready : Promise.resolve(read()),
  );
}
async function refresh(client: QueryClient) {
  await act(async () => {
    await client.refetchQueries({ queryKey: prefix });
  });
  const state = client.getQueryState(prefix);
  const canManage =
    state?.status === 'success' && !!(state.data as { can_manage?: boolean }).can_manage;
  await waitFor(() =>
    expect(screen.queryByLabelText(t('en', 'employeeDocuments.file')) !== null).toBe(canManage),
  );
}
// هيدرز موقّعة جديدة لازم توصل للتخزين؛ content-length وhost يستبعدهم المتصفح.
const ticketHeaders = {
  'content-type': 'application/pdf',
  'content-length': '3',
  'x-amz-meta-added-later': 'signed',
  'x-goog-meta-added-later': 'signed',
  host: 'storage.test',
};
function mockUpload(record?: () => Promise<unknown>, download?: Promise<unknown>) {
  api.POST.mockImplementation(async (path: string) => {
    if (path === '/v1/files/download') return download;
    if (path === '/v1/businesses/{businessId}/files/uploads')
      return {
        data: {
          id: fileId,
          upload_url: 'https://storage.test/upload',
          expires_in: 120,
          headers: ticketHeaders,
        },
      };
    if (path === '/v1/files/{id}/confirm') return { data: { id: fileId, status: 'QUEUED' } };
    return record ? record() : { data: recordedDocument };
  });
  put.mockResolvedValue({ ok: true });
}
async function startUpload() {
  fireEvent.change(await screen.findByLabelText(t('en', 'employeeDocuments.file')), {
    target: { files: [new File(['pdf'], 'civil.pdf', { type: 'application/pdf' })] },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'employeeDocuments.expiresOn')), {
    target: { value: '2026-10-20' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'employeeDocuments.upload') }));
}
it('lists current documents with their badge only after a fresh read and evicts them on close', async () => {
  api.GET.mockResolvedValueOnce({ data: view(false) });
  const { client, unmount } = setup();
  await waitFor(() =>
    expect(screen.getByText(t('en', 'employeeDocuments.status_EXPIRING'))).toBeTruthy(),
  );
  expect(screen.queryByRole('button', { name: t('en', 'employeeDocuments.upload') })).toBeNull();
  unmount();
  expect(client.getQueryCache().findAll({ queryKey: prefix })).toEqual([]);
});
it('uploads through files, waits for READY, then records by file id with an idempotency key', async () => {
  api.GET.mockImplementation(async (path: string) =>
    path === '/v1/files/{id}' ? readyFile : { data: view() },
  );
  mockUpload();
  setup();
  const input = await screen.findByLabelText(t('en', 'employeeDocuments.file'));
  fireEvent.change(input, {
    target: { files: [new File(['pdf'], 'civil.pdf', { type: 'application/pdf' })] },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'employeeDocuments.expiresOn')), {
    target: { value: '2026-10-20' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'employeeDocuments.upload') }));
  await waitFor(() => expect(screen.getByText(t('en', 'employeeDocuments.recorded'))).toBeTruthy());
  expect(api.POST.mock.calls.map((call) => call[0])).toEqual([
    '/v1/businesses/{businessId}/files/uploads',
    '/v1/files/{id}/confirm',
    '/v1/businesses/{businessId}/employees/{employeeId}/documents',
  ]);
  expect(api.POST.mock.calls[0]?.[1].body).toMatchObject({
    owner_module: 'staff',
    owner_entity_id: id,
    required_permission: 'read:files:business',
  });
  const recorded = api.POST.mock.calls[2]?.[1];
  expect(recorded.body).toEqual({
    type_code: 'civil_id',
    file_id: fileId,
    expires_on: '2026-10-20',
  });
  expect(recorded.params.header['Idempotency-Key']).toEqual(expect.any(String));
  expect(put).toHaveBeenCalledWith(
    'https://storage.test/upload',
    expect.objectContaining({
      method: 'PUT',
      headers: {
        'content-type': 'application/pdf',
        'x-amz-meta-added-later': 'signed',
        'x-goog-meta-added-later': 'signed',
      },
    }),
  );
});
it('refuses a missing required expiry or an unsupported file before any upload', async () => {
  api.GET.mockResolvedValue({ data: view() });
  setup();
  const input = await screen.findByLabelText(t('en', 'employeeDocuments.file'));
  fireEvent.change(input, {
    target: { files: [new File(['x'], 'x.webp', { type: 'image/webp' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'employeeDocuments.upload') }));
  await waitFor(() => expect(screen.getByText(t('en', 'employeeDocuments.invalid'))).toBeTruthy());
  expect(api.POST).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
});
it('cleans a finished upload during a temporary query error and recovers', async () => {
  const ready = deferred<unknown>();
  let failed = false;
  mockDocuments(ready.promise, () => (failed ? failure('Temporary') : { data: view() }));
  mockUpload();
  const { client } = setup();
  await startUpload();
  await screen.findByText(verifying);
  failed = true;
  await refresh(client);
  expect(screen.getByRole('alert').textContent).toBe('Temporary');
  await settle(ready, readyFile);
  await waitFor(() => expect(screen.queryByText(verifying)).toBeNull());
  failed = false;
  await refresh(client);
  await startUpload();
  expect(await screen.findByText(t('en', 'employeeDocuments.recorded'))).toBeTruthy();
});
it('latches read and write revocation while preserving recovery for new operations', async () => {
  const ready = deferred<unknown>();
  const download = deferred<unknown>();
  let current = view();
  let refused = false;
  mockDocuments(ready.promise, () => (refused ? failure('Denied') : { data: current }));
  mockUpload(undefined, download.promise);
  const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
  const { client } = setup();
  await screen.findByLabelText(t('en', 'employeeDocuments.file'));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'employeeDocuments.open') }));
  await startUpload();
  await screen.findByText(verifying);
  current = { ...view(), can_manage: false };
  await refresh(client);
  current = view();
  await refresh(client);
  await settle(ready, readyFile);
  await waitFor(() => expect(screen.queryByText(verifying)).toBeNull());
  expect(screen.queryByText(t('en', 'employeeDocuments.recorded'))).toBeNull();
  refused = true;
  await refresh(client);
  refused = false;
  await refresh(client);
  await settle(download, privateDownload);
  expect(opened).not.toHaveBeenCalled();
  await waitFor(() => expect(openButton().hasAttribute('disabled')).toBe(false));
  fireEvent.click(openButton());
  await waitFor(() => expect(opened).toHaveBeenCalledOnce());
  await startUpload();
  expect(await screen.findByText(t('en', 'employeeDocuments.recorded'))).toBeTruthy();
});
it('hides document success when write access was revoked during the POST', async () => {
  const posted = deferred<unknown>();
  let current = view();
  api.GET.mockImplementation(async (path: string) => ({
    data: path === '/v1/files/{id}' ? readyFile.data : current,
  }));
  mockUpload(() => posted.promise);
  const { client } = setup();
  await startUpload();
  await waitFor(() => expect(api.POST).toHaveBeenCalledWith(recordPath, expect.anything()));
  current = { ...view(), can_manage: false };
  await refresh(client);
  current = view();
  await refresh(client);
  await settle(posted, { data: recordedDocument });
  await waitFor(() => expect(screen.queryByText(uploading)).toBeNull());
  expect(screen.queryByText(t('en', 'employeeDocuments.recorded'))).toBeNull();
});
it.each(['companyId', 'businessId', 'userId', 'employeeId'] as const)(
  'resets replacement type when %s changes',
  async (field) => {
    let changed = false;
    const initial = {
      ...view(),
      items: [{ ...recordedDocument, type_code: 'passport' }],
      types: [civil, passport],
    };
    const next = { ...view(), items: [], types: [civil] };
    api.GET.mockImplementation(async () => ({ data: changed ? next : initial }));
    const page = setup();
    fireEvent.click(
      await screen.findByRole('button', { name: t('en', 'employeeDocuments.replace') }),
    );
    const selectedType = () =>
      (screen.getByLabelText(t('en', 'employeeDocuments.type')) as HTMLSelectElement).value;
    expect(selectedType()).toBe('passport');
    changed = true;
    for (const nextProps of [{ ...props, [field]: other }, props]) {
      page.rerender(
        <QueryClientProvider client={page.client}>
          <EmployeeDocumentsSection {...nextProps} />
        </QueryClientProvider>,
      );
      await waitFor(() => expect(selectedType()).toBe('civil_id'));
      expect(screen.queryByRole('option', { name: 'Passport' })).toBeNull();
    }
  },
);
