import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CustomerImportPanel } from '../ui/customer-import-panel';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('./upload-customer-import-file', () => ({
  uploadCustomerImportFile: async () => 'file-id',
}));

const company = '01920000-0000-7000-8000-0000000000a1';
const business = '01920000-0000-7000-8000-0000000000b1';
const user = '01920000-0000-7000-8000-0000000000c1';
const firstPreview = '01920000-0000-7000-8000-0000000000e1';
const secondPreview = '01920000-0000-7000-8000-0000000000e2';

function previewRow(row: number, name: string) {
  return { row, masked_phone: '***123', name, locale: 'ar', status: 'new', warning: null };
}

function cleanPreview(
  previewId: string,
  nextCursor: string | null = null,
  name = 'First Customer',
) {
  return {
    data: {
      preview_id: previewId,
      row_count: 1,
      new_count: 1,
      existing_count: 0,
      error_count: 0,
      errors: [],
      rows: [previewRow(2, name)],
      next_cursor: nextCursor,
    },
  };
}

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const choose = (name: string) =>
  fireEvent.change(screen.getByLabelText(t('en', 'customerImport.choose')), {
    target: { files: [new File(['synthetic'], name)] },
  });

function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CustomerImportPanel scope={{ companyId: company, businessId: business, userId: user }} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  api.POST.mockReset();
  api.GET.mockReset();
  api.GET.mockImplementation(async (path: string) => {
    if (path.endsWith('/template'))
      return {
        data: {
          file_name: 'customers.xlsx',
          content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          content_base64: 'UEsD',
        },
      };
    if (path.endsWith('/rows'))
      return { data: { items: [previewRow(4, 'Second Customer')], next_cursor: null } };
    return {
      data: {
        preview_id: firstPreview,
        status: 'commit_requested',
        created_count: 0,
        error_code: null,
      },
    };
  });
});
afterEach(() => cleanup());

it('clears the preview of file A immediately when file B is chosen', async () => {
  mount();
  api.POST.mockResolvedValue(cleanPreview(firstPreview));
  choose('A.xlsx');
  fireEvent.click(button(t('en', 'customerImport.preview')));
  await waitFor(() => expect(button(t('en', 'customerImport.commit')).disabled).toBe(false));
  expect(screen.getByText('First Customer')).toBeTruthy();
  choose('B.xlsx');
  expect(button(t('en', 'customerImport.commit')).disabled).toBe(true);
  expect(screen.queryByText(t('en', 'customerImport.clean'))).toBeNull();
  expect(screen.queryByText('First Customer')).toBeNull();
});

it('discards a late preview for a superseded file and keeps the commit disabled', async () => {
  mount();
  let resolve!: (value: ReturnType<typeof cleanPreview>) => void;
  api.POST.mockReturnValueOnce(
    new Promise<ReturnType<typeof cleanPreview>>((done) => (resolve = done)),
  );
  choose('A.xlsx');
  fireEvent.click(button(t('en', 'customerImport.preview')));
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
  choose('B.xlsx');
  await act(async () => resolve(cleanPreview(firstPreview)));
  await waitFor(() => expect(button(t('en', 'customerImport.preview')).disabled).toBe(false));
  expect(button(t('en', 'customerImport.commit')).disabled).toBe(true);
  expect(screen.queryByText('First Customer')).toBeNull();
});

it('appends the next page of rows while the preview still has a cursor', async () => {
  mount();
  api.POST.mockResolvedValue(cleanPreview(firstPreview, '22'));
  choose('A.xlsx');
  fireEvent.click(button(t('en', 'customerImport.preview')));
  await waitFor(() => expect(screen.getByText('First Customer')).toBeTruthy());
  fireEvent.click(button(t('en', 'customerImport.loadMoreRows')));
  await waitFor(() => expect(screen.getByText('Second Customer')).toBeTruthy());
  expect(screen.getByText('First Customer')).toBeTruthy();
  expect(
    api.GET.mock.calls.some(
      (call) => call[0].endsWith('/rows') && call[1].params.query.cursor === '22',
    ),
  ).toBe(true);
});

it('rejects a late rows page whose preview has been replaced on the same file', async () => {
  mount();
  let resolveRows!: (value: unknown) => void;
  api.GET.mockImplementation(async (path: string) =>
    path.endsWith('/rows')
      ? new Promise((done) => (resolveRows = done))
      : {
          data: {
            file_name: 'customers.xlsx',
            content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            content_base64: 'UEsD',
          },
        },
  );
  api.POST.mockResolvedValueOnce(cleanPreview(firstPreview, '22'));
  choose('A.xlsx');
  fireEvent.click(button(t('en', 'customerImport.preview')));
  await waitFor(() => expect(button(t('en', 'customerImport.loadMoreRows')).disabled).toBe(false));
  fireEvent.click(button(t('en', 'customerImport.loadMoreRows')));
  api.POST.mockResolvedValueOnce(cleanPreview(secondPreview, '22', 'Replacement Customer'));
  fireEvent.click(button(t('en', 'customerImport.preview')));
  await waitFor(() => expect(screen.getByText('Replacement Customer')).toBeTruthy());
  await act(async () =>
    resolveRows({ data: { items: [previewRow(4, 'Stale Customer')], next_cursor: null } }),
  );
  expect(screen.queryByText('Stale Customer')).toBeNull();
  expect(screen.getByText('Replacement Customer')).toBeTruthy();
});

it('keeps only the preview id in session storage after a commit is accepted', async () => {
  mount();
  api.POST.mockResolvedValueOnce(cleanPreview(firstPreview));
  choose('A.xlsx');
  fireEvent.click(button(t('en', 'customerImport.preview')));
  await waitFor(() => expect(button(t('en', 'customerImport.commit')).disabled).toBe(false));
  api.POST.mockResolvedValueOnce({ data: { preview_id: firstPreview } });
  fireEvent.click(button(t('en', 'customerImport.commit')));
  await waitFor(() => expect(sessionStorage.length).toBe(1));
  const key = sessionStorage.key(0) ?? '';
  expect(key).toBe(`customer-import:${company}:${business}:business:${user}`);
  expect(sessionStorage.getItem(key)).toBe(firstPreview);
  expect(JSON.stringify(Object.entries(sessionStorage))).not.toContain('Customer');
});
