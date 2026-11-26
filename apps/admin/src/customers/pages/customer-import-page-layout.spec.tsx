import { t } from '@pospay/i18n';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceController } from '@/workspace/model/workspace-provider';
import { CustomerImportRoute } from '../../../app/(dashboard)/_frame/customer-import-route';
import { CustomerImportPage } from './customer-import-page';

const state = vi.hoisted(() => ({
  scope: undefined as unknown,
  userId: 'user' as string | null,
  workspace: undefined as unknown,
  template: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: { file_name: 'c.xlsx', content_base64: 'UEsD' },
  },
  preview: { isPending: false, isError: false, error: null as unknown, mutate: vi.fn() },
  rows: { isPending: false, isError: false, error: null as unknown, mutate: vi.fn() },
  commit: {
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null as unknown,
    data: undefined,
    mutate: vi.fn(),
  },
  status: { timedOut: false, isError: false, error: null as unknown, data: undefined },
  request: {
    preview: undefined as unknown,
    rows: [] as unknown[],
    nextCursor: null as string | null,
    currentToken: () => 1,
  },
  selection: { file: undefined, resumedPreviewId: undefined },
  select: vi.fn(),
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('@/shared/browser/use-mounted', () => ({ useMounted: () => true }));
vi.mock('@/session/api/use-session', () => ({ useSessionUser: () => state.userId }));
vi.mock('@/workspace/model/workspace-provider', () => ({ useWorkspace: () => state.workspace }));
vi.mock('../api/use-customer-import', () => ({
  useCustomerImport: (scope: unknown) => {
    state.scope = scope;
    return state;
  },
}));

// الإطار يضيف أصناف التكديس على غلاف الجدول فقط عند تفعيل stacked؛ لا شيء مرئيًا يميّزها في jsdom.
const STACKED_CLASS = 'max-[599.99px]:[&_table]:block';
const HEADER_ROW_CLASSES = ['bg-transparent!'];
const HEADER_CELL_CLASSES = ['text-sm!', 'font-bold!', 'text-inherit!'];

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
const branch = {
  id: 'branch',
  name_ar: null,
  name_en: 'Synthetic branch',
  effective_timezone: 'Asia/Kuwait',
  is_active: true,
};

const follows = (first: Node, second: Node) =>
  Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
const cleanRow = {
  row: 2,
  masked_phone: '***123',
  name: 'Synthetic Customer',
  locale: 'ar',
  status: 'new',
  warning: null,
};
const renderPage = () =>
  render(<CustomerImportPage companyId="company" business={business} userId="user" />);

function readyWorkspace(scope: 'COMPANY' | 'BRANCH', withBranch: boolean) {
  state.workspace = {
    status: 'ready',
    company: {
      id: 'company',
      name_ar: null,
      name_en: 'Synthetic company',
      businesses: [],
      role_code: 'owner',
      scope,
    },
    business,
    ...(withBranch ? { branch } : {}),
    companies: [],
    choose: vi.fn(),
  } satisfies Partial<WorkspaceController> & Record<string, unknown>;
}

beforeEach(() => {
  state.userId = 'user';
  state.scope = undefined;
  state.request.preview = undefined;
  state.request.rows = [];
  readyWorkspace('COMPANY', false);
});

it('opens as a form page and shows the full lead inside the card before the Template section', () => {
  renderPage();
  const heading = screen.getByRole('heading', { level: 1, name: t('en', 'customerImport.title') });
  expect(heading.closest('[data-page-shell="form"]')).not.toBeNull();
  const lead = screen.getByText(t('en', 'customerImport.lead'));
  const template = screen.getByRole('heading', {
    level: 2,
    name: t('en', 'customerImport.sectionTemplate'),
  });
  expect(heading.closest('header')?.contains(lead)).toBe(false);
  expect(template.closest('.rounded-card')?.contains(lead)).toBe(true);
  expect(follows(lead, template)).toBe(true);
  expect(lead.className.split(' ')).not.toContain('truncate');
});

it('holds twelve-column sections, then Download, Choose, Preview and Commit with Commit last', () => {
  renderPage();
  const template = screen.getByRole('heading', {
    level: 2,
    name: t('en', 'customerImport.sectionTemplate'),
  });
  const file = screen.getByRole('heading', {
    level: 2,
    name: t('en', 'customerImport.sectionFile'),
  });
  const card = template.closest('.rounded-card') as HTMLElement;
  const download = within(card).getByRole('button', { name: t('en', 'customerImport.download') });
  const choose = within(card).getByLabelText(t('en', 'customerImport.choose'));
  const preview = within(card).getByRole('button', { name: t('en', 'customerImport.preview') });
  const commit = within(card).getByRole('button', { name: t('en', 'customerImport.commit') });
  expect(download.closest('.col-span-12.min-w-0')).not.toBeNull();
  expect(choose.closest('label')?.className).toContain('col-span-12');
  expect(follows(template, download)).toBe(true);
  expect(follows(download, file)).toBe(true);
  expect(follows(file, choose)).toBe(true);
  expect(follows(choose, preview)).toBe(true);
  expect(follows(preview, commit)).toBe(true);
  expect(choose.getAttribute('accept')).toBe('.xlsx');
});

it('shows the rows to fix below the card, stacked, with a plain header and labelled cells', () => {
  state.request.preview = {
    preview_id: 'p',
    row_count: 2,
    new_count: 1,
    existing_count: 0,
    error_count: 1,
    errors: [{ row: 4, column: 'phone', code: 'IMPORT_PHONE_INVALID' }],
    rows: [],
    next_cursor: null,
  };
  renderPage();
  const table = screen.getByRole('table');
  const card = screen
    .getByRole('heading', { level: 2, name: t('en', 'customerImport.sectionTemplate') })
    .closest('.rounded-card') as HTMLElement;
  expect(card.contains(table)).toBe(false);
  expect(follows(card, table)).toBe(true);
  expect(table.parentElement?.className).toContain(STACKED_CLASS);
  const cells = within(screen.getAllByRole('row')[1] as HTMLElement).getAllByRole('cell');
  expect(cells.map((cell) => cell.getAttribute('data-cell-label'))).toEqual([
    null,
    t('en', 'customerImport.column'),
    t('en', 'customerImport.reason'),
  ]);
  expect(cells[0]?.querySelector('span')?.getAttribute('dir')).toBe('ltr');
  HEADER_ROW_CLASSES.forEach((name) =>
    expect(table.querySelector('thead')?.classList.contains(name)).toBe(true),
  );
  within(table)
    .getAllByRole('columnheader')
    .forEach((header) =>
      HEADER_CELL_CLASSES.forEach((name) => expect(header.classList.contains(name)).toBe(true)),
    );
});

it('shows the clean rows stacked with labelled cells and a left-to-right masked phone', () => {
  state.request.preview = {
    preview_id: 'p',
    row_count: 1,
    new_count: 1,
    existing_count: 0,
    error_count: 0,
    errors: [],
    rows: [cleanRow],
    next_cursor: null,
  };
  state.request.rows = [cleanRow];
  renderPage();
  const table = screen.getByRole('table');
  expect(table.parentElement?.className).toContain(STACKED_CLASS);
  expect(within(table).getByText(t('en', 'customerImport.rowsTitle'))).toBeTruthy();
  const cells = within(screen.getAllByRole('row')[1] as HTMLElement).getAllByRole('cell');
  expect(cells.map((cell) => cell.getAttribute('data-cell-label'))).toEqual([
    null,
    t('en', 'customerImport.col_name'),
    t('en', 'customerImport.col_phone'),
    t('en', 'customerImport.col_locale'),
    t('en', 'customerImport.col_status'),
    t('en', 'customerImport.col_warning'),
  ]);
  expect(within(table).getByText('***123').getAttribute('dir')).toBe('ltr');
});

it('lets a business manager import at business scope with no branch in the request', () => {
  readyWorkspace('COMPANY', true);
  render(<CustomerImportRoute />);
  expect(
    screen.getByRole('heading', { level: 1, name: t('en', 'customerImport.title') }),
  ).toBeTruthy();
  expect(state.scope).toEqual({ companyId: 'company', businessId: 'business', userId: 'user' });
});

it('sends a branch-scoped user to their branch and asks for one when none is chosen', () => {
  readyWorkspace('BRANCH', true);
  const { unmount } = render(<CustomerImportRoute />);
  expect(state.scope).toEqual({
    companyId: 'company',
    businessId: 'business',
    branchId: 'branch',
    userId: 'user',
  });
  unmount();
  readyWorkspace('BRANCH', false);
  render(<CustomerImportRoute />);
  expect(screen.getByText(t('en', 'customerImport.chooseBranch'))).toBeTruthy();
});

it('asks for a business first and renders nothing before the workspace is ready', () => {
  state.workspace = { ...(state.workspace as object), business: undefined };
  const { unmount } = render(<CustomerImportRoute />);
  expect(screen.getByText(t('en', 'admin.chooseBusiness'))).toBeTruthy();
  unmount();
  state.workspace = { status: 'loading', companies: [], choose: vi.fn() };
  const empty = render(<CustomerImportRoute />);
  expect(empty.container.textContent).toBe('');
});
