import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PackageImportPanel } from '../ui/package-import-panel';
import { PACKAGE_IMPORT_POLL_DEADLINE_MS } from './use-package-import-status';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const company = '01920000-0000-7000-8000-0000000000a1';
const business = '01920000-0000-7000-8000-0000000000b1';
const user = '01920000-0000-7000-8000-0000000000c1';
const fileId = '01920000-0000-7000-8000-0000000000f9';
const previewId = '01920000-0000-7000-8000-0000000000e1';
const storageKey = `package-import:${company}:${business}:${user}`;
const label = (key: string) => t('en', `packageImport.${key}` as never);

const put = vi.fn();
// استجابات حالة المعاينة بالترتيب؛ الأخيرة تثبت عند استنفاد القائمة.
let statuses: unknown[] = [];

const pending = { preview_id: previewId, status: 'pending' };
const ready = (errors: unknown[] = []) => ({
  preview_id: previewId,
  status: 'ready',
  row_count: 2,
  error_count: errors.length,
  skipped_count: 1,
  errors,
});

function readResponse(path: string) {
  if (path.endsWith('/import/template'))
    return {
      data: { file_name: 'packages.xlsx', content_type: XLSX, content_base64: 'UEsDBA==' },
    };
  if (path === '/v1/files/{id}')
    return { data: { id: fileId, status: 'READY', content_type: XLSX, size_bytes: 4 } };
  const next = statuses.length > 1 ? statuses.shift() : statuses[0];
  return { data: next };
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
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PackageImportPanel companyId={company} businessId={business} userId={user} />
    </QueryClientProvider>,
  );
}

async function chooseAndPreview() {
  const input = await screen.findByLabelText(label('choose'));
  fireEvent.change(input, {
    target: { files: [new File(['PK'], 'packages.xlsx', { type: XLSX })] },
  });
  fireEvent.click(screen.getByRole('button', { name: label('preview') }));
}

const commitButton = () =>
  screen.getByRole('button', { name: label('commit') }) as HTMLButtonElement;

it('uploads through the orders files policy, polls the async preview, then commits and polls to the result', async () => {
  statuses = [
    pending,
    ready(),
    { preview_id: previewId, status: 'commit_requested' },
    { preview_id: previewId, status: 'committed', created_count: 2, skipped_count: 1 },
  ];
  setup();
  await chooseAndPreview();

  await waitFor(() => expect(screen.getByText(label('clean'))).toBeTruthy(), { timeout: 5000 });
  expect(sessionStorage.getItem(storageKey)).toBe(previewId);
  expect(api.POST.mock.calls.map((call) => call[0])).toEqual([
    '/v1/businesses/{businessId}/files/uploads',
    '/v1/files/{id}/confirm',
    '/v1/businesses/{businessId}/packages/import/previews',
  ]);
  expect(api.POST.mock.calls[0]?.[1].body).toMatchObject({
    owner_module: 'orders',
    owner_entity_id: business,
    required_permission: 'read:files:business',
    content_type: XLSX,
  });
  expect(api.POST.mock.calls[2]?.[1].body).toEqual({ file_id: fileId });
  expect(screen.getByText(label('rowCount')).textContent).toContain('2');

  fireEvent.click(commitButton());
  await waitFor(() => expect(screen.getByText(`${label('committed')} 2`)).toBeTruthy(), {
    timeout: 6000,
  });
  const commit = api.POST.mock.calls[3]?.[1];
  expect(api.POST.mock.calls[3]?.[0]).toBe('/v1/businesses/{businessId}/packages/import/commits');
  expect(commit.body).toEqual({ preview_id: previewId });
  expect(commit.params.header['Idempotency-Key']).toEqual(expect.any(String));
  expect(screen.getByText(label('skippedCount'), { exact: false }).textContent).toContain('1');
  expect(sessionStorage.getItem(storageKey)).toBeNull();
}, 20000);

it('names the row error and keeps the commit disabled while the preview carries one', async () => {
  statuses = [ready([{ row: 3, column: 'service_2', code: 'IMPORT_SERVICE_NOT_FOUND' }])];
  setup();
  await chooseAndPreview();

  await waitFor(() =>
    expect(screen.getByText(label('code_IMPORT_SERVICE_NOT_FOUND'))).toBeTruthy(),
  );
  expect(screen.getByText(`${label('col_service')} 2`)).toBeTruthy();
  expect(commitButton().disabled).toBe(true);
  expect(sessionStorage.getItem(storageKey)).toBeNull();
});

it('shows the delayed guidance when the preview never leaves pending within two minutes', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  statuses = [pending];
  setup();
  await chooseAndPreview();
  await waitFor(() => expect(screen.getByText(label('pending'))).toBeTruthy());

  await act(async () => {
    await vi.advanceTimersByTimeAsync(PACKAGE_IMPORT_POLL_DEADLINE_MS + 1000);
  });
  await waitFor(() => expect(screen.getByText(label('delayed'))).toBeTruthy());
});
