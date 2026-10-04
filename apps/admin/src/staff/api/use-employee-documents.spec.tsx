import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmployeeDocumentsSection } from '../ui/employee-documents-section';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
const id = '01920000-0000-7000-8000-0000000000a2';
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
    path === '/v1/files/{id}'
      ? { data: { id: fileId, status: 'READY', content_type: 'application/pdf', size_bytes: 3 } }
      : { data: view() },
  );
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
    return { data: recordedDocument };
  });
  put.mockResolvedValue({ ok: true });
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
    expect.objectContaining({ method: 'PUT' }),
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
