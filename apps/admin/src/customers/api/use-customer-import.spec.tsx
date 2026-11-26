import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CustomerImportPanel } from '../ui/customer-import-panel';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
const locale = vi.hoisted(() => ({ value: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => locale.value }));

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const company = '01920000-0000-7000-8000-0000000000a1';
const business = '01920000-0000-7000-8000-0000000000b1';
const branch = '01920000-0000-7000-8000-0000000000d1';
const user = '01920000-0000-7000-8000-0000000000c1';
const fileId = '01920000-0000-7000-8000-0000000000f9';
const previewId = '01920000-0000-7000-8000-0000000000e1';

const put = vi.fn();

function readResponse(path: string) {
  if (path.endsWith('/import/template'))
    return {
      data: { file_name: 'customers.xlsx', content_type: XLSX, content_base64: 'UEsDBA==' },
    };
  if (path === '/v1/files/{id}')
    return { data: { id: fileId, status: 'READY', content_type: XLSX, size_bytes: 4 } };
  return {
    data: { preview_id: previewId, status: 'committed', created_count: 2, error_code: null },
  };
}

function writeResponse(path: string) {
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
  if (path.endsWith('/import/previews'))
    return {
      data: {
        preview_id: previewId,
        row_count: 1,
        new_count: 1,
        existing_count: 0,
        error_count: 0,
        errors: [],
        rows: [
          {
            row: 2,
            masked_phone: '***123',
            name: 'Synthetic',
            locale: 'ar',
            status: 'new',
            warning: null,
          },
        ],
        next_cursor: null,
      },
    };
  return { data: { preview_id: previewId } };
}

beforeEach(() => {
  locale.value = 'en';
  sessionStorage.clear();
  api.GET.mockReset();
  api.POST.mockReset();
  put.mockReset();
  put.mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', put);
  api.GET.mockImplementation(async (path: string) => readResponse(path));
  api.POST.mockImplementation(async (path: string) => writeResponse(path));
});
afterEach(() => vi.unstubAllGlobals());

function setup(branchId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CustomerImportPanel
        scope={{
          companyId: company,
          businessId: business,
          ...(branchId ? { branchId } : {}),
          userId: user,
        }}
      />
    </QueryClientProvider>,
  );
}

async function runFlow() {
  const input = await screen.findByLabelText(t('en', 'customerImport.choose'));
  fireEvent.change(input, {
    target: { files: [new File(['PK'], 'customers.xlsx', { type: XLSX })] },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'customerImport.preview') }));
  await waitFor(() => expect(screen.getByText(t('en', 'customerImport.clean'))).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: t('en', 'customerImport.commit') }));
  await waitFor(() =>
    expect(screen.getByText(new RegExp(t('en', 'customerImport.committed')))).toBeTruthy(),
  );
}

it('uploads, previews and commits at business scope with an idempotency key', async () => {
  setup();
  await runFlow();
  expect(api.POST.mock.calls.map((call) => call[0])).toEqual([
    '/v1/businesses/{businessId}/files/uploads',
    '/v1/files/{id}/confirm',
    '/v1/businesses/{businessId}/customers/import/previews',
    '/v1/businesses/{businessId}/customers/import/commits',
  ]);
  const ticket = api.POST.mock.calls[0]?.[1].body;
  expect(ticket).toMatchObject({
    owner_module: 'customers',
    owner_entity_id: business,
    required_permission: 'read:files:business',
    content_type: XLSX,
  });
  expect(ticket).not.toHaveProperty('branch_id');
  expect(api.POST.mock.calls[2]?.[1].body).toEqual({ file_id: fileId });
  const commit = api.POST.mock.calls[3]?.[1];
  expect(commit.body).toEqual({ preview_id: previewId });
  expect(commit.params.header['Idempotency-Key']).toEqual(expect.any(String));
  expect(
    api.GET.mock.calls.some(
      (call) => call[0] === '/v1/businesses/{businessId}/customers/import/template',
    ),
  ).toBe(true);
});

it('uploads, previews and commits at branch scope through the branch endpoints', async () => {
  setup(branch);
  await runFlow();
  expect(api.POST.mock.calls.map((call) => call[0])).toEqual([
    '/v1/businesses/{businessId}/files/uploads',
    '/v1/files/{id}/confirm',
    '/v1/branches/{branchId}/customers/import/previews',
    '/v1/branches/{branchId}/customers/import/commits',
  ]);
  expect(api.POST.mock.calls[0]?.[1].body).toMatchObject({
    owner_module: 'customers',
    branch_id: branch,
  });
  expect(api.POST.mock.calls[2]?.[1].params.path).toEqual({ branchId: branch });
  expect(api.POST.mock.calls[3]?.[1].params.header['Idempotency-Key']).toEqual(expect.any(String));
  const reads = api.GET.mock.calls.map((call) => call[0]);
  expect(reads).toContain('/v1/branches/{branchId}/customers/import/template');
  expect(reads).toContain('/v1/branches/{branchId}/customers/import/previews/{previewId}');
  expect(reads.some((path) => path.startsWith('/v1/businesses/{businessId}/customers'))).toBe(
    false,
  );
});
