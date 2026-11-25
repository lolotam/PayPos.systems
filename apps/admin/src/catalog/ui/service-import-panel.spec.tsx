import { serviceImportRow, type ServiceImportRow } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { ServiceImportPanel } from './service-import-panel';

const locale = vi.hoisted(() => ({ value: 'en' as 'ar' | 'en' }));

const state = vi.hoisted(() => ({
  template: {
    isPending: false,
    isError: false,
    data: { file_name: 'services.xlsx', content_base64: 'UEsD' },
  },
  preview: {
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null as unknown,
    mutate: vi.fn(),
    reset: vi.fn(),
  },
  rows: {
    isPending: false,
    isError: false,
    error: null as unknown,
    mutate: vi.fn(),
    reset: vi.fn(),
  },
  commit: {
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null as unknown,
    data: undefined as { preview_id: string } | undefined,
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
    preview: undefined as unknown,
    rows: [] as unknown[],
    nextCursor: null as string | null,
    currentToken: () => 1,
    restart: vi.fn(),
    acceptPreview: vi.fn(),
    acceptRows: vi.fn(),
  },
  selection: {
    file: undefined as File | undefined,
    select: vi.fn(),
    remember: vi.fn(),
    release: vi.fn(),
    resumedPreviewId: undefined as string | undefined,
  },
  select: vi.fn(),
}));

vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => locale.value }));
vi.mock('../api/use-service-import', () => ({ useServiceImport: () => state }));

const panel = () => <ServiceImportPanel companyId="company" businessId="business" userId="user" />;
const button = (name: string) =>
  screen.getByRole('button', { name }) as HTMLButtonElement;

function cleanRow(): ServiceImportRow {
  return serviceImportRow.parse({
    row: 2,
    name_en: 'Hair cut',
    name_ar: null,
    price: '12.500',
    duration_minutes: 90,
    category_id: null,
    category_name_en: null,
    commission_rule: { kind: 'FOLLOW_PLAN' },
    commission_value: null,
    commission_rule_defaulted: true,
    counts_toward_threshold: true,
  });
}

function previewWith(errors: { row: number; column: string; code: string }[], rows: ServiceImportRow[]) {
  return {
    preview_id: 'p',
    row_count: rows.length,
    error_count: errors.length,
    errors,
    rows,
    next_cursor: null,
  };
}

beforeEach(() => {
  locale.value = 'en';
  state.preview.isSuccess = false;
  state.commit.isSuccess = false;
  state.commit.isPending = false;
  state.status.data = undefined;
  state.status.timedOut = false;
  state.request.preview = undefined;
  state.request.rows = [];
  state.request.nextCursor = null;
  state.selection.file = undefined;
});

it('keeps the commit disabled and names every row error while the preview is dirty', () => {
  state.request.preview = previewWith(
    [{ row: 3, column: 'price', code: 'IMPORT_PRICE_INVALID' }],
    [],
  );
  render(panel());
  expect(screen.getByText(t('en', 'catalogServiceImport.code_IMPORT_PRICE_INVALID'))).toBeTruthy();
  const errorsTable = screen.getByRole('table');
  expect(
    within(errorsTable).getByText(t('en', 'catalogServiceImport.column_price')),
  ).toBeTruthy();
  expect(button(t('en', 'catalogServiceImport.commit')).disabled).toBe(true);
});

it('enables the commit on a clean preview and marks the defaulted commission rule', () => {
  state.request.preview = previewWith([], [cleanRow()]);
  state.request.rows = [cleanRow()];
  render(panel());
  expect(button(t('en', 'catalogServiceImport.commit')).disabled).toBe(false);
  expect(screen.getByText(t('en', 'catalogServiceImport.ruleDefaulted'))).toBeTruthy();
  expect(screen.getByText(t('en', 'catalogServiceImport.colPrice'))).toBeTruthy();
});

it('shows the defaulted commission rule in Arabic too', () => {
  locale.value = 'ar';
  state.request.preview = previewWith([], [cleanRow()]);
  state.request.rows = [cleanRow()];
  render(panel());
  expect(screen.getByText(t('ar', 'catalogServiceImport.ruleDefaulted'))).toBeTruthy();
  expect(button(t('ar', 'catalogServiceImport.commit')).disabled).toBe(false);
});

it('offers the next page only while the preview has a cursor', () => {
  state.request.preview = previewWith([], [cleanRow()]);
  state.request.rows = [cleanRow()];
  state.request.nextCursor = '101';
  render(panel());
  const loadMore = button(t('en', 'catalogServiceImport.loadMoreRows'));
  expect(loadMore.disabled).toBe(false);
  fireEvent.click(loadMore);
  expect(state.rows.mutate).toHaveBeenCalledTimes(1);
});

it('shows the pending state after the commit and the created count when the worker finishes', () => {
  state.commit.isSuccess = true;
  state.commit.data = { preview_id: 'p' };
  state.status.data = { preview_id: 'p', status: 'commit_requested', created_count: 0, error_code: null };
  const { rerender } = render(panel());
  expect(screen.getByRole('status').textContent).toBe(t('en', 'catalogServiceImport.pending'));
  state.status.data = { preview_id: 'p', status: 'committed', created_count: 4, error_code: null };
  rerender(panel());
  expect(screen.getByRole('status').textContent).toContain('4');
});

it('shows the failure with the code the worker refused with', () => {
  state.commit.isSuccess = true;
  state.commit.data = { preview_id: 'p' };
  state.status.data = {
    preview_id: 'p',
    status: 'failed',
    created_count: 0,
    error_code: 'IMPORT_SERVICE_EXISTS',
  };
  render(panel());
  const alert = screen.getByRole('alert');
  expect(alert.textContent).toContain(t('en', 'catalogServiceImport.failed'));
  expect(alert.textContent).toContain(
    t('en', 'catalogServiceImport.code_IMPORT_SERVICE_EXISTS'),
  );
});

it('shows the delayed state when the polling deadline passes', () => {
  state.status.timedOut = true;
  state.status.data = { preview_id: 'p', status: 'commit_requested', created_count: 0, error_code: null };
  render(panel());
  expect(screen.getByRole('status').textContent).toBe(t('en', 'catalogServiceImport.delayed'));
  expect(t('ar', 'catalogServiceImport.delayed')).not.toBe(
    t('en', 'catalogServiceImport.delayed'),
  );
});

it('shows the PCT and FIXED rules with their values next to the defaulted rule', () => {
  const pct = serviceImportRow.parse({
    ...cleanRow(),
    row: 3,
    name_en: 'Colour',
    commission_rule: { kind: 'PCT', value: 1500 },
    commission_value: 1500,
    commission_rule_defaulted: false,
  });
  const fixed = serviceImportRow.parse({
    ...cleanRow(),
    row: 4,
    name_en: 'Wash',
    commission_rule: { kind: 'FIXED', value: '0.500' },
    commission_value: '0.500',
    commission_rule_defaulted: false,
  });
  state.request.preview = previewWith([], [cleanRow(), pct, fixed]);
  state.request.rows = [cleanRow(), pct, fixed];
  render(panel());
  expect(screen.getByText(t('en', 'catalogServiceImport.ruleDefaulted'))).toBeTruthy();
  expect(screen.getByText(t('en', 'catalogServiceImport.rulePct'))).toBeTruthy();
  const colour = within(screen.getByText('Colour').closest('tr') as HTMLElement);
  expect(colour.getByText('1500')).toBeTruthy();
  expect(screen.getByText(t('en', 'catalogServiceImport.ruleFixed'))).toBeTruthy();
  const wash = within(screen.getByText('Wash').closest('tr') as HTMLElement);
  expect(wash.getByText('0.500', { selector: 'span[dir="ltr"].ms-1' })).toBeTruthy();
});

it('keeps the commit disabled while a commit request is pending', () => {
  state.request.preview = previewWith([], [cleanRow()]);
  state.request.rows = [cleanRow()];
  state.commit.isPending = true;
  render(panel());
  expect(button(t('en', 'catalogServiceImport.commit')).disabled).toBe(true);
});
