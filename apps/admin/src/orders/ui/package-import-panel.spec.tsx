import { t, type MessageKey } from '@pospay/i18n';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { PackageImportPanel } from './package-import-panel';

const locale = vi.hoisted(() => ({ value: 'en' as 'ar' | 'en' }));

const state = vi.hoisted(() => ({
  template: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: { file_name: 'packages.xlsx', content_base64: 'UEsD' },
  },
  preview: {
    isPending: false,
    isError: false,
    error: null as unknown,
    mutate: vi.fn(),
    reset: vi.fn(),
  },
  commit: {
    isPending: false,
    isError: false,
    error: null as unknown,
    mutate: vi.fn(),
    reset: vi.fn(),
  },
  status: {
    timedOut: false,
    isError: false,
    error: null as unknown,
    data: undefined as unknown,
  },
  request: {
    previewId: undefined as string | undefined,
    commitAccepted: false,
    currentToken: () => 1,
    restart: vi.fn(),
  },
  selection: {
    file: undefined as File | undefined,
    resumedPreviewId: undefined as string | undefined,
  },
  previewId: undefined as string | undefined,
  select: vi.fn(),
}));

vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => locale.value }));
vi.mock('../api/use-package-import', () => ({ usePackageImport: () => state }));

const panel = () => <PackageImportPanel companyId="company" businessId="business" userId="user" />;
const label = (key: string) => t(locale.value, `packageImport.${key}` as MessageKey);
const button = (key: string) =>
  screen.getByRole('button', { name: label(key) }) as HTMLButtonElement;

function ready(errors: { row: number; column: string; code: string }[], skipped = 0) {
  return {
    preview_id: 'p',
    status: 'ready',
    row_count: 3,
    error_count: errors.length,
    skipped_count: skipped,
    errors,
  };
}

function showPreview(status: unknown) {
  state.previewId = 'p';
  state.request.previewId = 'p';
  state.status.data = status;
}

beforeEach(() => {
  locale.value = 'en';
  state.template.isError = false;
  state.template.error = null;
  state.preview.isError = false;
  state.preview.error = null;
  state.preview.isPending = false;
  state.commit.isPending = false;
  state.commit.isError = false;
  state.commit.error = null;
  state.commit.mutate.mockReset();
  state.status.timedOut = false;
  state.status.isError = false;
  state.status.error = null;
  state.status.data = undefined;
  state.request.previewId = undefined;
  state.request.commitAccepted = false;
  state.selection.file = undefined;
  state.selection.resumedPreviewId = undefined;
  state.previewId = undefined;
});
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
});

it('downloads the template through a file anchor named by the server', () => {
  const create = vi.fn(() => 'blob:template');
  Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
  const anchors: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    anchors.push(this.download);
  });
  render(panel());
  expect(button('download').disabled).toBe(false);
  fireEvent.click(button('download'));
  expect(anchors).toEqual(['packages.xlsx']);
  expect(create).toHaveBeenCalledTimes(1);
});

it('disables the download and shows the server message when the template cannot load', () => {
  state.template.isError = true;
  state.template.error = {
    code: 'IMPORT_TEMPLATE_EXCEEDS_LIMITS',
    message_ar: 'Arabic template failure',
    message_en: 'Template limit exceeded',
  };
  render(panel());
  expect(button('download').disabled).toBe(true);
  expect(screen.getByRole('alert').textContent).toBe('Template limit exceeded');
});

it('disables the download while the template is loading', () => {
  state.template.isPending = true;
  render(panel());
  expect(button('download').disabled).toBe(true);
  state.template.isPending = false;
});

it('waits for the asynchronous preview and keeps the commit disabled', () => {
  showPreview({ preview_id: 'p', status: 'pending' });
  render(panel());
  expect(screen.getByRole('status').textContent).toBe(label('pending'));
  expect(button('commit').disabled).toBe(true);
});

it.each(['en', 'ar'] as const)(
  'names every numbered column and reason in %s and keeps the commit disabled while rows have errors',
  (language) => {
    locale.value = language;
    showPreview(
      ready([
        { row: 5, column: 'service_2', code: 'IMPORT_SERVICE_NOT_FOUND' },
        { row: 6, column: 'sessions_1', code: 'INVALID_SESSIONS' },
        { row: 7, column: 'remaining_20', code: 'INVALID_REMAINING_SESSIONS' },
        { row: 8, column: 'customer_phone', code: 'IMPORT_CUSTOMER_NOT_FOUND' },
        { row: 9, column: 'service_21', code: 'IMPORT_CELL_INVALID' },
      ]),
    );
    render(panel());
    const table = within(screen.getByRole('table'));
    expect(table.getByText(`${label('col_service')} 2`)).toBeTruthy();
    expect(table.getByText(`${label('col_sessions')} 1`)).toBeTruthy();
    expect(table.getByText(`${label('col_remaining')} 20`)).toBeTruthy();
    expect(table.getByText(label('col_customer_phone'))).toBeTruthy();
    expect(table.getByText(label('col_unexpected_column'))).toBeTruthy();
    expect(table.getByText(label('code_IMPORT_SERVICE_NOT_FOUND'))).toBeTruthy();
    expect(table.getByText(label('code_INVALID_SESSIONS'))).toBeTruthy();
    expect(table.getByText('5')).toBeTruthy();
    expect(screen.getByText(label('rowCount')).textContent).toContain('3');
    expect(button('commit').disabled).toBe(true);
    expect(screen.queryByText(label('clean'))).toBeNull();
    if (language === 'en') expect(table.getByText('Service 2')).toBeTruthy();
    if (language === 'ar')
      expect(table.getByText(`${label('col_service')} 2`).textContent).toMatch(/[\u0600-\u06FF]/);
  },
);

it('shows the counts and enables the commit on a clean preview, then blocks a duplicate click while pending', () => {
  showPreview(ready([], 1));
  const { rerender } = render(panel());
  expect(screen.getByText(label('rowCount')).textContent).toContain('3');
  expect(screen.getByText(label('skippedCount')).textContent).toContain('1');
  expect(screen.getByRole('status').textContent).toBe(label('clean'));
  expect(button('commit').disabled).toBe(false);
  fireEvent.click(button('commit'));
  expect(state.commit.mutate).toHaveBeenCalledWith({ token: 1, previewId: 'p' });
  state.commit.isPending = true;
  rerender(panel());
  expect(button('commit').disabled).toBe(true);
});

it('hides the commit once the request is accepted and shows the queued state', () => {
  showPreview({ preview_id: 'p', status: 'commit_requested' });
  state.request.commitAccepted = true;
  render(panel());
  expect(screen.getByRole('status').textContent).toBe(label('pending'));
  expect(button('commit').disabled).toBe(true);
});

it('shows the created and skipped counts when the commit finishes', () => {
  showPreview({ preview_id: 'p', status: 'committed', created_count: 4, skipped_count: 2 });
  state.request.commitAccepted = true;
  render(panel());
  expect(screen.getByRole('status').textContent).toBe(`${label('committed')} 4`);
  expect(screen.getByText(label('skippedCount'), { exact: false }).textContent).toContain('2');
});

it.each([
  ['IMPORT_SERVICE_NOT_FOUND', 'packageImport.code_IMPORT_SERVICE_NOT_FOUND'],
  ['IMPORT_COMMIT_FAILED', 'packageImport.code_IMPORT_COMMIT_FAILED'],
  ['IMPORT_PREVIEW_EXPIRED', 'packageImport.code_IMPORT_PREVIEW_EXPIRED'],
  ['IMPORT_PREVIEW_HAS_ERRORS', 'packageImport.code_IMPORT_PREVIEW_HAS_ERRORS'],
  ['IMPORT_HEADER_INVALID', 'errors.IMPORT_HEADER_INVALID'],
  ['IMPORT_ROW_LIMIT_EXCEEDED', 'errors.IMPORT_ROW_LIMIT_EXCEEDED'],
  ['STORAGE_UNAVAILABLE', 'errors.STORAGE_UNAVAILABLE'],
] as const)('shows the %s failure as a bilingual alert', (code, key) => {
  for (const language of ['en', 'ar'] as const) {
    locale.value = language;
    showPreview({ preview_id: 'p', status: 'failed', error_code: code });
    const { unmount } = render(panel());
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(t(language, 'packageImport.failed'));
    expect(alert.textContent).toContain(t(language, key as MessageKey));
    expect(t(language, key as MessageKey)).not.toBe(key);
    unmount();
  }
});

it('shows the delayed guidance when the polling deadline passes', () => {
  showPreview({ preview_id: 'p', status: 'commit_requested' });
  state.request.commitAccepted = true;
  state.status.timedOut = true;
  render(panel());
  expect(screen.getByRole('status').textContent).toBe(label('delayed'));
  expect(t('ar', 'packageImport.delayed')).not.toBe(t('en', 'packageImport.delayed'));
});

it('shows the server refusal message as an alert', () => {
  state.preview.isError = true;
  state.preview.error = {
    code: 'IMPORT_FILE_NOT_READY',
    message_ar: 'Arabic refusal',
    message_en: 'The import file has not passed verification yet.',
  };
  render(panel());
  expect(screen.getByRole('alert').textContent).toBe(
    'The import file has not passed verification yet.',
  );
});

it('ignores a status that belongs to another preview', () => {
  state.previewId = 'new';
  state.status.data = {
    preview_id: 'old',
    status: 'committed',
    created_count: 2,
    skipped_count: 0,
  };
  render(panel());
  expect(screen.queryByText(`${label('committed')} 2`)).toBeNull();
  expect(button('commit').disabled).toBe(true);
});
