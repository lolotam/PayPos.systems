import { customerImportRow, type CustomerImportRow } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CustomerImportPanel } from './customer-import-panel';

type Language = 'ar' | 'en';
const LANGUAGES: readonly Language[] = ['ar', 'en'];
const locale = vi.hoisted(() => ({ value: 'en' as 'ar' | 'en' }));

const state = vi.hoisted(() => ({
  template: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: { file_name: 'customers.xlsx', content_base64: 'UEsD' },
  },
  preview: { isPending: false, isError: false, error: null as unknown, mutate: vi.fn() },
  rows: { isPending: false, isError: false, error: null as unknown, mutate: vi.fn() },
  commit: {
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null as unknown,
    data: undefined as { preview_id: string } | undefined,
    mutate: vi.fn(),
  },
  status: { timedOut: false, isError: false, error: null as unknown, data: undefined as unknown },
  request: {
    preview: undefined as unknown,
    rows: [] as unknown[],
    nextCursor: null as string | null,
    currentToken: () => 1,
  },
  selection: {
    file: undefined as File | undefined,
    resumedPreviewId: undefined as string | undefined,
  },
  select: vi.fn(),
}));

vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => locale.value }));
vi.mock('../api/use-customer-import', () => ({ useCustomerImport: () => state }));

const scope = { companyId: 'company', businessId: 'business', userId: 'user' };
const panel = () => <CustomerImportPanel scope={scope} />;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

function cleanRow(overrides: Partial<CustomerImportRow> = {}): CustomerImportRow {
  return customerImportRow.parse({
    row: 2,
    masked_phone: '***123',
    name: 'Synthetic Customer',
    locale: 'ar',
    status: 'new',
    warning: null,
    ...overrides,
  });
}

function previewWith(
  errors: { row: number; column: string; code: string }[],
  rows: CustomerImportRow[],
) {
  return {
    preview_id: 'p',
    row_count: 5,
    new_count: 3,
    existing_count: 2,
    error_count: errors.length,
    errors,
    rows,
    next_cursor: null,
  };
}

beforeEach(() => {
  locale.value = 'en';
  state.template.isError = false;
  state.template.error = null;
  state.preview.isPending = false;
  state.commit.isSuccess = false;
  state.commit.isPending = false;
  state.commit.data = undefined;
  state.status.data = undefined;
  state.status.timedOut = false;
  state.request.preview = undefined;
  state.request.rows = [];
  state.request.nextCursor = null;
  state.selection.file = undefined;
  state.selection.resumedPreviewId = undefined;
  state.rows.mutate.mockReset();
});

it.each(LANGUAGES)('shows the three summary counts in %s', (language) => {
  locale.value = language;
  state.request.preview = previewWith([], [cleanRow()]);
  state.request.rows = [cleanRow()];
  render(panel());
  for (const [key, value] of [
    ['rowCount', '5'],
    ['newCount', '3'],
    ['existingCount', '2'],
  ] as const) {
    const item = screen.getByText(t(language, `customerImport.${key}`), { exact: false });
    expect(within(item.closest('li') as HTMLElement).getByText(value)).toBeTruthy();
  }
});

it.each(LANGUAGES)('names every row error and keeps the commit disabled in %s', (language) => {
  locale.value = language;
  state.request.preview = previewWith(
    [
      { row: 3, column: 'phone', code: 'IMPORT_PHONE_INVALID' },
      { row: 4, column: 'birthday', code: 'IMPORT_DATE_INVALID' },
    ],
    [],
  );
  render(panel());
  const table = screen.getByRole('table');
  expect(
    within(table).getByText(t(language, 'customerImport.code_IMPORT_PHONE_INVALID')),
  ).toBeTruthy();
  expect(
    within(table).getByText(t(language, 'customerImport.code_IMPORT_DATE_INVALID')),
  ).toBeTruthy();
  expect(within(table).getByText(t(language, 'customerImport.col_phone'))).toBeTruthy();
  expect(within(table).getByText(t(language, 'customerImport.col_birthday'))).toBeTruthy();
  expect(button(t(language, 'customerImport.commit')).disabled).toBe(true);
});

it.each(LANGUAGES)(
  'shows the masked phone, locale, status and warning on a clean preview in %s',
  (language) => {
    locale.value = language;
    const existing = cleanRow({
      row: 3,
      masked_phone: '***456',
      name: 'Existing Customer',
      locale: 'en',
      status: 'existing',
      warning: 'EXISTING_NO_RATING_IGNORED',
    });
    state.request.preview = previewWith([], [cleanRow(), existing]);
    state.request.rows = [cleanRow(), existing];
    render(panel());
    const first = within(screen.getByText('Synthetic Customer').closest('tr') as HTMLElement);
    expect(first.getByText('***123').getAttribute('dir')).toBe('ltr');
    expect(first.getByText(t(language, 'customerImport.locale_ar'))).toBeTruthy();
    expect(first.getByText(t(language, 'customerImport.status_new'))).toBeTruthy();
    const second = within(screen.getByText('Existing Customer').closest('tr') as HTMLElement);
    expect(second.getByText('***456').getAttribute('dir')).toBe('ltr');
    expect(second.getByText(t(language, 'customerImport.locale_en'))).toBeTruthy();
    expect(second.getByText(t(language, 'customerImport.status_existing'))).toBeTruthy();
    expect(
      second.getByText(t(language, 'customerImport.warning_EXISTING_NO_RATING_IGNORED')),
    ).toBeTruthy();
    expect(button(t(language, 'customerImport.commit')).disabled).toBe(false);
  },
);

it('words the non-blocking warning in Arabic as the owner wrote it', () => {
  locale.value = 'ar';
  const existing = cleanRow({ status: 'existing', warning: 'EXISTING_NO_RATING_IGNORED' });
  state.request.preview = previewWith([], [existing]);
  state.request.rows = [existing];
  render(panel());
  const warning = t('ar', 'customerImport.warning_EXISTING_NO_RATING_IGNORED');
  expect(warning).not.toBe(t('en', 'customerImport.warning_EXISTING_NO_RATING_IGNORED'));
  expect(screen.getByText(warning)).toBeTruthy();
});

it('offers the next page only while the preview has a cursor, and clicking asks for it', () => {
  state.request.preview = previewWith([], [cleanRow()]);
  state.request.rows = [cleanRow()];
  const { rerender } = render(panel());
  expect(screen.queryByRole('button', { name: t('en', 'customerImport.loadMoreRows') })).toBeNull();
  state.request.nextCursor = '22';
  rerender(panel());
  fireEvent.click(button(t('en', 'customerImport.loadMoreRows')));
  expect(state.rows.mutate).toHaveBeenCalledWith({ token: 1, previewId: 'p', cursor: '22' });
});

it.each(LANGUAGES)(
  'shows pending, then the created count when the worker finishes in %s',
  (language) => {
    locale.value = language;
    state.commit.isSuccess = true;
    state.commit.data = { preview_id: 'p' };
    state.status.data = {
      preview_id: 'p',
      status: 'commit_requested',
      created_count: 0,
      error_code: null,
    };
    const { rerender } = render(panel());
    expect(screen.getByRole('status').textContent).toBe(t(language, 'customerImport.pending'));
    state.status.data = {
      preview_id: 'p',
      status: 'committed',
      created_count: 4,
      error_code: null,
    };
    rerender(panel());
    const done = screen.getByRole('status');
    expect(done.textContent).toContain(t(language, 'customerImport.committed'));
    expect(within(done).getByText('4').getAttribute('dir')).toBe('ltr');
  },
);

it.each(LANGUAGES)('shows the failure with the refusal code in %s', (language) => {
  locale.value = language;
  state.commit.isSuccess = true;
  state.commit.data = { preview_id: 'p' };
  state.status.data = {
    preview_id: 'p',
    status: 'failed',
    created_count: 0,
    error_code: 'IMPORT_COMMIT_FAILED',
  };
  render(panel());
  expect(screen.getByRole('alert').textContent).toBe(
    t(language, 'customerImport.commit_IMPORT_COMMIT_FAILED'),
  );
});

it('shows the delayed notice once polling has timed out', () => {
  state.status.timedOut = true;
  state.status.data = {
    preview_id: 'p',
    status: 'commit_requested',
    created_count: 0,
    error_code: null,
  };
  render(panel());
  expect(screen.getByRole('status').textContent).toBe(t('en', 'customerImport.delayed'));
});

it('blocks the commit while a commit or a preview is in flight, and the preview while a commit is', () => {
  state.selection.file = new File(['x'], 'customers.xlsx');
  const { rerender } = render(panel());
  const fileInput = screen.getByLabelText(t('en', 'customerImport.choose')) as HTMLInputElement;
  expect(fileInput.disabled).toBe(false);
  expect(button(t('en', 'customerImport.preview')).disabled).toBe(false);
  expect(button(t('en', 'customerImport.commit')).disabled).toBe(true);
  state.request.preview = previewWith([], [cleanRow()]);
  state.request.rows = [cleanRow()];
  rerender(panel());
  expect(button(t('en', 'customerImport.commit')).disabled).toBe(false);
  expect(button(t('en', 'customerImport.preview')).disabled).toBe(false);
  state.commit.isPending = true;
  rerender(panel());
  expect(fileInput.disabled).toBe(true);
  expect(button(t('en', 'customerImport.commit')).disabled).toBe(true);
  expect(button(t('en', 'customerImport.preview')).disabled).toBe(true);
  state.commit.isPending = false;
  state.commit.isSuccess = true;
  state.commit.data = { preview_id: 'p' };
  state.status.data = {
    preview_id: 'p',
    status: 'commit_requested',
    created_count: 0,
    error_code: null,
  };
  rerender(panel());
  expect(fileInput.disabled).toBe(true);
  expect(button(t('en', 'customerImport.preview')).disabled).toBe(true);
  expect(button(t('en', 'customerImport.commit')).disabled).toBe(true);
  state.status.data = {
    preview_id: 'p',
    status: 'committed',
    created_count: 2,
    error_code: null,
  };
  rerender(panel());
  expect(fileInput.disabled).toBe(false);
  expect(button(t('en', 'customerImport.preview')).disabled).toBe(false);
  state.commit.isSuccess = false;
  state.commit.data = undefined;
  state.status.data = undefined;
  state.preview.isPending = true;
  rerender(panel());
  expect(button(t('en', 'customerImport.commit')).disabled).toBe(true);
  expect(screen.getByText(t('en', 'customerImport.checking')).getAttribute('role')).toBe('status');
});

it.each(LANGUAGES)('shows the template refusal message in %s', (language) => {
  locale.value = language;
  state.template.isError = true;
  state.template.error = {
    code: 'IMPORT_TEMPLATE_EXCEEDS_LIMITS',
    message_ar: 'Arabic template failure',
    message_en: 'Template limit exceeded',
  };
  render(panel());
  expect(button(t(language, 'customerImport.download')).disabled).toBe(true);
  expect(screen.getByRole('alert').textContent).toBe(
    language === 'ar' ? 'Arabic template failure' : 'Template limit exceeded',
  );
});

it('hides the prior committed outcome when a new preview replaces it', () => {
  state.commit.isSuccess = true;
  state.commit.data = { preview_id: 'p-old' };
  state.status.data = {
    preview_id: 'p-old',
    status: 'committed',
    created_count: 2,
    error_code: null,
  };
  state.request.preview = { ...previewWith([], [cleanRow()]), preview_id: 'p-new' };
  state.request.rows = [cleanRow()];
  render(panel());
  expect(screen.queryByText(new RegExp(t('en', 'customerImport.committed')))).toBeNull();
  expect(button(t('en', 'customerImport.commit')).disabled).toBe(false);
});
