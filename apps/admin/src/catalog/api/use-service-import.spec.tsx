import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ServiceImportPanel } from '../ui/service-import-panel';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const company = '01920000-0000-7000-8000-0000000000a1';
const business = '01920000-0000-7000-8000-0000000000b1';
const user = '01920000-0000-7000-8000-0000000000c1';
const fileId = '01920000-0000-7000-8000-0000000000f9';
const previewId = '01920000-0000-7000-8000-0000000000e1';

const put = vi.fn();

function previewRow(row: number, nameEn: string) {
  return {
    row,
    name_en: nameEn,
    name_ar: null,
    price: '12.500',
    duration_minutes: 90,
    category_id: null,
    category_name_en: null,
    commission_rule: { kind: 'FOLLOW_PLAN' },
    commission_value: null,
    commission_rule_defaulted: true,
    counts_toward_threshold: true,
  };
}

function readResponse(path: string) {
  if (path.endsWith('/import/template'))
    return {
      data: { file_name: 'services.xlsx', content_type: XLSX, content_base64: 'UEsDBA==' },
    };
  if (path === '/v1/files/{id}')
    return { data: { id: fileId, status: 'READY', content_type: XLSX, size_bytes: 4 } };
  return {
    data: {
      preview_id: previewId,
      status: 'committed',
      created_count: 2,
      error_code: null,
    },
  };
}

async function writeResponse(path: string) {
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
        row_count: 2,
        error_count: 0,
        errors: [],
        rows: [previewRow(2, 'Hair cut')],
        next_cursor: null,
      },
    };
  return { data: { preview_id: previewId } };
}

beforeEach(() => {
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

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ServiceImportPanel companyId={company} businessId={business} userId={user} />
    </QueryClientProvider>,
  );
}

it('uploads through the catalog files policy, previews without errors, then commits with an idempotency key', async () => {
  setup();
  const input = await screen.findByLabelText(t('en', 'catalogServiceImport.choose'));
  fireEvent.change(input, {
    target: { files: [new File(['PK'], 'services.xlsx', { type: XLSX })] },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'catalogServiceImport.preview') }));

  await waitFor(() => expect(screen.getByText(t('en', 'catalogServiceImport.clean'))).toBeTruthy());
  expect(api.POST.mock.calls.map((call) => call[0])).toEqual([
    '/v1/businesses/{businessId}/files/uploads',
    '/v1/files/{id}/confirm',
    '/v1/businesses/{businessId}/services/import/previews',
  ]);
  expect(api.POST.mock.calls[0]?.[1].body).toMatchObject({
    owner_module: 'catalog',
    owner_entity_id: business,
    required_permission: 'read:files:business',
    content_type: XLSX,
  });
  expect(api.POST.mock.calls[2]?.[1].body).toEqual({ file_id: fileId });

  fireEvent.click(screen.getByRole('button', { name: t('en', 'catalogServiceImport.commit') }));
  await waitFor(() =>
    expect(screen.getByText(new RegExp(t('en', 'catalogServiceImport.committed')))).toBeTruthy(),
  );
  const commit = api.POST.mock.calls[3]?.[1];
  expect(commit.body).toEqual({ preview_id: previewId });
  expect(commit.params.header['Idempotency-Key']).toEqual(expect.any(String));
});

it('disables the commit and names the row error while the preview carries one', async () => {
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
        errors: [{ row: 3, column: 'price', code: 'IMPORT_PRICE_INVALID' }],
        rows: [],
        next_cursor: null,
      },
    };
  });

  setup();
  const input = await screen.findByLabelText(t('en', 'catalogServiceImport.choose'));
  fireEvent.change(input, {
    target: { files: [new File(['PK'], 'services.xlsx', { type: XLSX })] },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'catalogServiceImport.preview') }));

  await waitFor(() =>
    expect(screen.getByText(t('en', 'catalogServiceImport.code_IMPORT_PRICE_INVALID'))).toBeTruthy(),
  );
  const commit = screen.getByRole('button', {
    name: t('en', 'catalogServiceImport.commit'),
  }) as HTMLButtonElement;
  expect(commit.disabled).toBe(true);
});
