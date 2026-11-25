import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ServiceImportPanel } from '../ui/service-import-panel';
import { SERVICE_IMPORT_POLL_DEADLINE_MS } from './use-service-import-status';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
const locale = vi.hoisted(() => ({ value: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => locale.value }));
vi.mock('./upload-service-import-file', () => ({
  uploadServiceImportFile: async () => 'file-id',
}));

const company = '01920000-0000-7000-8000-0000000000a1';
const business = '01920000-0000-7000-8000-0000000000b1';
const user = '01920000-0000-7000-8000-0000000000c1';
const firstPreview = '01920000-0000-7000-8000-0000000000e1';

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

function cleanPreview(previewId: string, nextCursor: string | null = null) {
  return {
    data: {
      preview_id: previewId,
      row_count: 1,
      error_count: 0,
      errors: [],
      rows: [previewRow(2, 'Hair cut')],
      next_cursor: nextCursor,
    },
  };
}

function button(name: string) {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

function select(name: string, language: 'ar' | 'en' = 'en') {
  fireEvent.change(screen.getByLabelText(t(language, 'catalogServiceImport.choose')), {
    target: { files: [new File(['synthetic'], name)] },
  });
}

beforeEach(() => {
  locale.value = 'en';
  sessionStorage.clear();
  api.POST.mockReset();
  api.GET.mockReset();
  api.GET.mockImplementation(async (path: string) => {
    if (path.endsWith('/rows'))
      return { data: { items: [previewRow(4, 'Colour')], next_cursor: null } };
    return {
      data: {
        preview_id: firstPreview,
        status: 'committed',
        created_count: 2,
        error_code: null,
      },
    };
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ServiceImportPanel companyId={company} businessId={business} userId={user} />
    </QueryClientProvider>,
  );
});

it('clears the preview of file A immediately when file B is chosen', async () => {
  api.POST.mockResolvedValue(cleanPreview(firstPreview));
  select('A.xlsx');
  fireEvent.click(button(t('en', 'catalogServiceImport.preview')));
  await waitFor(() => expect(button(t('en', 'catalogServiceImport.commit')).disabled).toBe(false));
  expect(screen.getByText(t('en', 'catalogServiceImport.clean'))).toBeTruthy();
  select('B.xlsx');
  expect(button(t('en', 'catalogServiceImport.commit')).disabled).toBe(true);
  expect(screen.queryByText(t('en', 'catalogServiceImport.clean'))).toBeNull();
});

it('discards a late preview for a superseded file and keeps the commit disabled', async () => {
  let resolve!: (result: ReturnType<typeof cleanPreview>) => void;
  api.POST.mockReturnValueOnce(
    new Promise<ReturnType<typeof cleanPreview>>((done) => {
      resolve = done;
    }),
  );
  select('A.xlsx');
  fireEvent.click(button(t('en', 'catalogServiceImport.preview')));
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
  select('B.xlsx');
  await act(async () => resolve(cleanPreview(firstPreview)));
  await waitFor(() => expect(button(t('en', 'catalogServiceImport.preview')).disabled).toBe(false));
  expect(button(t('en', 'catalogServiceImport.commit')).disabled).toBe(true);
  expect(screen.queryByText(t('en', 'catalogServiceImport.clean'))).toBeNull();
});

it('appends the next page of rows while the preview still has a cursor', async () => {
  api.POST.mockResolvedValue(cleanPreview(firstPreview, '101'));
  select('A.xlsx');
  fireEvent.click(button(t('en', 'catalogServiceImport.preview')));
  await waitFor(() => expect(screen.getByText('Hair cut')).toBeTruthy());
  expect(screen.queryByText('Colour')).toBeNull();
  fireEvent.click(button(t('en', 'catalogServiceImport.loadMoreRows')));
  await waitFor(() => expect(screen.getByText('Colour')).toBeTruthy());
  expect(screen.getByText('Hair cut')).toBeTruthy();
  expect(
    api.GET.mock.calls.some((call) => call[0].endsWith('/rows') && call[1].params.query.cursor === '101'),
  ).toBe(true);
});

it('reads the persisted request again when the page is reopened', async () => {
  sessionStorage.setItem(`service-import:${company}:${business}:${user}`, firstPreview);
  api.GET.mockResolvedValue({
    data: {
      preview_id: firstPreview,
      status: 'committed',
      created_count: 3,
      error_code: null,
    },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ServiceImportPanel companyId={company} businessId={business} userId={user} />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      api.GET.mock.calls.some((call) => call[0].endsWith('/previews/{previewId}')),
    ).toBe(true),
  );
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('3'));
});

it('moves to the delayed state when polling passes the two-minute deadline', async () => {
  vi.useFakeTimers();
  try {
    sessionStorage.setItem(`service-import:${company}:${business}:${user}`, firstPreview);
    api.GET.mockResolvedValue({
      data: {
        preview_id: firstPreview,
        status: 'commit_requested',
        created_count: 0,
        error_code: null,
      },
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ServiceImportPanel companyId={company} businessId={business} userId={user} />
      </QueryClientProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getAllByRole('status').at(-1)?.textContent).toBe(
      t('en', 'catalogServiceImport.pending'),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SERVICE_IMPORT_POLL_DEADLINE_MS);
    });
    expect(screen.getAllByRole('status').at(-1)?.textContent).toBe(
      t('en', 'catalogServiceImport.delayed'),
    );
  } finally {
    vi.useRealTimers();
  }
});

it.each(['en', 'ar'] as const)('shows the %s envelope message in one alert', async (language) => {
  cleanup();
  locale.value = language;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ServiceImportPanel companyId={company} businessId={business} userId={user} />
    </QueryClientProvider>,
  );
  api.POST.mockResolvedValue({
    error: { code: 'IMPORT_FILE_INVALID', message_ar: 'AR message', message_en: 'English message' },
    response: { status: 422 },
  });
  select('A.xlsx', language);
  fireEvent.click(button(t(language, 'catalogServiceImport.preview')));
  const alerts = await screen.findAllByRole('alert');
  expect(alerts).toHaveLength(1);
  expect(alerts[0]?.textContent).toBe(language === 'ar' ? 'AR message' : 'English message');
  expect(document.body.textContent).not.toContain('[object Object]');
});
