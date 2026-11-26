import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CustomerImportPanel } from '../ui/customer-import-panel';
import type { uploadCustomerImportFile } from './upload-customer-import-file';
import { CUSTOMER_IMPORT_POLL_DEADLINE_MS } from './use-customer-import-status';

type UploadFile = typeof uploadCustomerImportFile;

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
const upload = vi.hoisted(() => ({
  run: undefined as undefined | ((options: unknown) => Promise<string>),
}));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('./upload-customer-import-file', () => ({
  uploadCustomerImportFile: (options: unknown) =>
    upload.run ? upload.run(options) : Promise.resolve('file-id'),
}));

const company = '01920000-0000-7000-8000-0000000000a1';
const business = '01920000-0000-7000-8000-0000000000b1';
const branch = '01920000-0000-7000-8000-0000000000d1';
const user = '01920000-0000-7000-8000-0000000000c1';
const previewId = '01920000-0000-7000-8000-0000000000e1';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const statusPath = '/v1/businesses/{businessId}/customers/import/previews/{previewId}';

function replyFor(path: string, status: string) {
  if (path.endsWith('/template'))
    return { data: { file_name: 'c.xlsx', content_type: XLSX, content_base64: 'UEsD' } };
  return {
    data: {
      preview_id: previewId,
      status,
      created_count: status === 'committed' ? 2 : 0,
      error_code: status === 'failed' ? 'IMPORT_COMMIT_FAILED' : null,
    },
  };
}

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const choose = (name: string) =>
  fireEvent.change(screen.getByLabelText(t('en', 'customerImport.choose')), {
    target: { files: [new File(['synthetic'], name)] },
  });
const statusCalls = () => api.GET.mock.calls.filter((call) => call[0] === statusPath).length;

function mount(branchId?: string) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
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

beforeEach(() => {
  sessionStorage.clear();
  upload.run = undefined;
  api.POST.mockReset();
  api.GET.mockReset();
  api.GET.mockImplementation(async (path: string) => replyFor(path, 'committed'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function startPolling(branchId?: string) {
  vi.useFakeTimers();
  sessionStorage.setItem(
    `customer-import:${company}:${business}:${branchId ?? 'business'}:${user}`,
    previewId,
  );
  const view = mount(branchId);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  return view;
}

it('polls every second while the commit is requested and stops on committed', async () => {
  api.GET.mockImplementation(async (path: string) => replyFor(path, 'commit_requested'));
  await startPolling();
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(statusCalls()).toBeGreaterThanOrEqual(3);
  api.GET.mockImplementation(async (path: string) => replyFor(path, 'committed'));
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(screen.getByRole('status').textContent).toContain(t('en', 'customerImport.committed'));
  const settled = statusCalls();
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(statusCalls()).toBe(settled);
});

it('stops polling on failed and shows the refusal', async () => {
  api.GET.mockImplementation(async (path: string) => replyFor(path, 'commit_requested'));
  await startPolling();
  api.GET.mockImplementation(async (path: string) => replyFor(path, 'failed'));
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(screen.getByRole('alert').textContent).toBe(
    t('en', 'customerImport.commit_IMPORT_COMMIT_FAILED'),
  );
  const settled = statusCalls();
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(statusCalls()).toBe(settled);
});

it('stops at the two-minute deadline and shows the delayed notice', async () => {
  api.GET.mockImplementation(async (path: string) => replyFor(path, 'commit_requested'));
  await startPolling();
  await act(async () => vi.advanceTimersByTimeAsync(CUSTOMER_IMPORT_POLL_DEADLINE_MS + 1000));
  expect(screen.getAllByRole('status').at(-1)?.textContent).toBe(t('en', 'customerImport.delayed'));
  const settled = statusCalls();
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(statusCalls()).toBe(settled);
});

it('stops status polling completely when the page unmounts', async () => {
  api.GET.mockImplementation(async (path: string) => replyFor(path, 'commit_requested'));
  const view = await startPolling();
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(statusCalls()).toBeGreaterThan(0);
  view.unmount();
  const settled = statusCalls();
  await act(async () => vi.advanceTimersByTimeAsync(CUSTOMER_IMPORT_POLL_DEADLINE_MS));
  expect(statusCalls()).toBe(settled);
});

it.each([
  ['business', undefined, statusPath],
  ['branch', branch, '/v1/branches/{branchId}/customers/import/previews/{previewId}'],
] as const)(
  'resumes the stored preview at %s scope and clears the key on a final result',
  async (_label, branchId, expectedPath) => {
    await startPolling(branchId);
    expect(api.GET.mock.calls.some((call) => call[0] === expectedPath)).toBe(true);
    expect(screen.getByRole('status').textContent).toContain(t('en', 'customerImport.committed'));
    expect(
      sessionStorage.getItem(
        `customer-import:${company}:${business}:${branchId ?? 'business'}:${user}`,
      ),
    ).toBeNull();
  },
);

it('stops status polling on 404 and clears the stored preview id', async () => {
  api.GET.mockImplementation(async (path: string) =>
    path.endsWith('/template')
      ? replyFor(path, 'committed')
      : {
          error: { code: 'IMPORT_PREVIEW_NOT_FOUND' },
          response: new Response(null, { status: 404 }),
        },
  );
  await startPolling();
  const settled = statusCalls();
  expect(settled).toBe(1);
  expect(
    sessionStorage.getItem(`customer-import:${company}:${business}:business:${user}`),
  ).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(statusCalls()).toBe(settled);
});

async function startVerifyingUpload() {
  const actual = await vi.importActual<{ uploadCustomerImportFile: UploadFile }>(
    './upload-customer-import-file',
  );
  upload.run = (options) => actual.uploadCustomerImportFile(options as Parameters<UploadFile>[0]);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  api.POST.mockImplementation(async (path: string) =>
    path === '/v1/businesses/{businessId}/files/uploads'
      ? {
          data: {
            id: previewId,
            upload_url: 'https://storage.test/u',
            expires_in: 120,
            headers: { 'content-type': XLSX, 'content-length': '4' },
          },
        }
      : { data: { id: previewId, status: 'QUEUED' } },
  );
  const fileCalls = () => api.GET.mock.calls.filter((call) => call[0] === '/v1/files/{id}').length;
  api.GET.mockImplementation(async (path: string) =>
    path === '/v1/files/{id}'
      ? { data: { id: previewId, status: 'VERIFYING', content_type: XLSX, size_bytes: 4 } }
      : { data: { file_name: 'c.xlsx', content_type: XLSX, content_base64: 'UEsD' } },
  );
  vi.useFakeTimers();
  const view = mount();
  choose('A.xlsx');
  fireEvent.click(button(t('en', 'customerImport.preview')));
  for (let step = 0; step < 4; step += 1) {
    await act(async () => vi.advanceTimersByTimeAsync(1000));
  }
  expect(fileCalls()).toBeGreaterThanOrEqual(3);
  return { view, fileCalls };
}

it('stops the upload status polling when the page unmounts', async () => {
  const { view, fileCalls } = await startVerifyingUpload();
  view.unmount();
  const settled = fileCalls();
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(fileCalls()).toBe(settled);
});

it('stops the upload status polling when another file is chosen', async () => {
  const { fileCalls } = await startVerifyingUpload();
  choose('B.xlsx');
  const settled = fileCalls();
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(fileCalls()).toBe(settled);
});
