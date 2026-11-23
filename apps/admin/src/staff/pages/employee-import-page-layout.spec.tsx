import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EmployeeImportPage } from './employee-import-page';

const state = vi.hoisted(() => {
  const mutation = () => ({
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null as unknown,
    data: undefined as Record<string, unknown> | undefined,
    mutate: vi.fn(),
    reset: vi.fn(),
  });
  return {
    template: {
      isPending: false,
      isError: false,
      data: { file_name: 'employees.xlsx', content_base64: 'UEsD' },
    },
    preview: mutation(),
    commit: mutation(),
    status: {
      timedOut: false,
      isError: false,
      error: null as unknown,
      data: undefined as Record<string, unknown> | undefined,
    },
  };
});
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('../api/use-employee-import', () => ({ useEmployeeImport: () => state }));

const business = {
  id: 'business',
  name_en: 'Synthetic salon',
  name_ar: null,
  business_type: 'salon' as const,
  country: null,
  vertical_type: 'salon' as const,
  timezone: 'Asia/Kuwait',
  branches: [],
};
// الإطار يضيف أصناف التكديس على غلاف الجدول فقط عند تفعيل stacked؛ لا شيء مرئيًا يميّزها في jsdom.
const STACKED_CLASS = 'max-[599.99px]:[&_table]:block';

function follows(first: Node, second: Node) {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function renderPage() {
  render(<EmployeeImportPage companyId="company" business={business} userId="user" />);
}

function previewWithErrors() {
  state.preview.isSuccess = true;
  state.preview.data = {
    preview_id: 'p',
    row_count: 2,
    error_count: 1,
    errors: [{ row: 4, column: 'name_en', code: 'IMPORT_NAME_INVALID' }],
  };
  state.preview.mutate.mockImplementation((_, callbacks) =>
    callbacks?.onSuccess(state.preview.data),
  );
  renderPage();
  fireEvent.change(screen.getByLabelText('Choose the filled .xlsx file'), {
    target: { files: [new File(['synthetic'], 'employees.xlsx')] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
}

beforeEach(() => {
  state.preview.isSuccess = false;
  state.preview.data = undefined;
  state.commit.isSuccess = false;
  state.commit.data = undefined;
  state.status.data = undefined;
  state.preview.mutate.mockReset();
});

it('opens as a form page with the heading and the description', () => {
  renderPage();
  const heading = screen.getByRole('heading', { level: 1, name: 'Import employees' });
  expect(heading.closest('[data-page-shell="form"]')).not.toBeNull();
  expect(
    screen.getByText('Download the template, fill it, upload it and preview before committing.'),
  ).toBeTruthy();
});

it('holds two titled sections in one card, then the actions at the foot with commit last', () => {
  renderPage();
  const template = screen.getByRole('heading', { level: 2, name: 'Template' });
  const file = screen.getByRole('heading', { level: 2, name: 'File' });
  const card = template.closest('.rounded-card') as HTMLElement;
  const download = within(card).getByRole('button', { name: 'Download template' });
  const choose = within(card).getByLabelText('Choose the filled .xlsx file');
  const preview = within(card).getByRole('button', { name: 'Preview' });
  const commit = within(card).getByRole('button', { name: 'Commit import' });
  expect(card.contains(file)).toBe(true);
  expect(follows(template, download)).toBe(true);
  expect(follows(download, file)).toBe(true);
  expect(follows(file, choose)).toBe(true);
  expect(follows(choose, preview)).toBe(true);
  expect(follows(preview, commit)).toBe(true);
});

it('shows the rows to fix below the card, stacked, with every cell after the row number labelled', () => {
  previewWithErrors();
  const table = screen.getByRole('table');
  const card = screen.getByRole('heading', { level: 2, name: 'Template' }).closest('.rounded-card');
  expect(card?.contains(table)).toBe(false);
  expect(follows(card as HTMLElement, table)).toBe(true);
  expect(table.parentElement?.className).toContain(STACKED_CLASS);
  expect(within(table).getByText('Rows to fix')).toBeTruthy();
  const cells = within(screen.getAllByRole('row')[1] as HTMLElement).getAllByRole('cell');
  expect(cells.map((cell) => cell.getAttribute('data-cell-label'))).toEqual([
    null,
    'Column',
    'Reason',
  ]);
  expect(cells[0]?.textContent).toBe('4');
});
