import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmployeeImportPanel } from '../ui/employee-import-panel';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const company = '01920000-0000-7000-8000-0000000000a1';
const business = '01920000-0000-7000-8000-0000000000b1';
const user = '01920000-0000-7000-8000-0000000000c1';
const fileId = '01920000-0000-7000-8000-0000000000f9';
const previewId = '01920000-0000-7000-8000-0000000000e1';
const props = { companyId: company, businessId: business, userId: user };

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
  render(
    <QueryClientProvider client={client}>
      <EmployeeImportPanel {...props} />
    </QueryClientProvider>,
  );
}

function readyGet(path: string) {
  if (path === '/v1/files/{id}')
    return Promise.resolve({ data: { id: fileId, status: 'READY', content_type: XLSX, size_bytes: 4 } });
  return Promise.resolve({
    data: { file_name: 'employees.xlsx', content_type: XLSX, content_base64: 'UEsDBA==' },
  });
}

it('uploads through the staff files policy, previews without errors, then commits with an idempotency key', async () => {
  api.GET.mockImplementation(readyGet);
  api.POST.mockImplementation(async (path: string) => {
    if (path === '/v1/businesses/{businessId}/files/uploads')
      return {
        data: {
          id: fileId,
          upload_url: 'https://storage.test/upload',
          expires_in: 120,
          headers: { 'content-type': XLSX, 'content-length': '4' },
        },
      };
    if (path === '/v1/files/{id}/confirm') return { data: { id: fileId, status: 'QUEUED' } };
    if (path.endsWith('/previews'))
      return {
        data: { preview_id: previewId, row_count: 1, error_count: 0, errors: [] },
      };
    return { data: { preview_id: previewId, created_count: 1, employee_ids: [previewId] } };
  });
  put.mockResolvedValue({ ok: true });

  setup();
  const input = await screen.findByLabelText(t('en', 'employeeImport.choose'));
  fireEvent.change(input, { target: { files: [new File(['PK\x03\x04'], 'employees.xlsx', { type: XLSX })] } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'employeeImport.preview') }));

  await waitFor(() => expect(screen.getByText(t('en', 'employeeImport.clean'))).toBeTruthy());
  expect(api.POST.mock.calls.map((call) => call[0])).toEqual([
    '/v1/businesses/{businessId}/files/uploads',
    '/v1/files/{id}/confirm',
    '/v1/businesses/{businessId}/employees/import/previews',
  ]);
  expect(api.POST.mock.calls[0]?.[1].body).toMatchObject({
    owner_module: 'staff',
    owner_entity_id: business,
    required_permission: 'read:files:business',
  });
  expect(api.POST.mock.calls[2]?.[1].body).toEqual({ file_id: fileId });

  fireEvent.click(screen.getByRole('button', { name: t('en', 'employeeImport.commit') }));
  await waitFor(() =>
    expect(screen.getByText(new RegExp(t('en', 'employeeImport.committed')))).toBeTruthy(),
  );
  const commit = api.POST.mock.calls[3]?.[1];
  expect(commit.body).toEqual({ preview_id: previewId });
  expect(commit.params.header['Idempotency-Key']).toEqual(expect.any(String));
});

it('disables commit and shows every named row error until the preview is clean', async () => {
  api.GET.mockImplementation(readyGet);
  api.POST.mockImplementation(async (path: string) => {
    if (path === '/v1/businesses/{businessId}/files/uploads')
      return {
        data: {
          id: fileId,
          upload_url: 'https://storage.test/upload',
          expires_in: 120,
          headers: { 'content-type': XLSX, 'content-length': '4' },
        },
      };
    if (path === '/v1/files/{id}/confirm') return { data: { id: fileId, status: 'QUEUED' } };
    return {
      data: {
        preview_id: previewId,
        row_count: 1,
        error_count: 1,
        errors: [{ row: 3, column: 'primary_branch', code: 'IMPORT_BRANCH_NOT_FOUND' }],
      },
    };
  });
  put.mockResolvedValue({ ok: true });

  setup();
  const input = await screen.findByLabelText(t('en', 'employeeImport.choose'));
  fireEvent.change(input, { target: { files: [new File(['PK\x03\x04'], 'employees.xlsx', { type: XLSX })] } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'employeeImport.preview') }));

  await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());
  expect(screen.getByText(t('en', 'employeeImport.code_IMPORT_BRANCH_NOT_FOUND'))).toBeTruthy();
  const commit = screen.getByRole('button', { name: t('en', 'employeeImport.commit') }) as HTMLButtonElement;
  expect(commit.disabled).toBe(true);
});
