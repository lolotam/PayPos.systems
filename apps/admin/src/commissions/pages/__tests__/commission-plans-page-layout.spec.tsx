import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/shared/api/query-client';
import {
  blockedCorrectionPage,
  blockedCorrectionsPath,
  BUSINESS,
  COMPANY,
  EMP_A,
  USER,
  employeeItem,
  employeePage,
  employeesPath,
  ok,
  routeGet,
  versionItem,
  versionPage,
  versionsPath,
} from '../../api/__tests__/plan-http';
import { CommissionPlansPage } from '../commission-plans-page';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));

// الإطار يضيف أصناف التكديس على غلاف الجدول فقط عند تفعيل stacked؛ لا شيء مرئيًا يميّزها في jsdom.
const STACKED_CLASS = 'max-[599.99px]:[&_table]:block';

function follows(first: Node, second: Node) {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function renderPage() {
  routeGet(api.GET, (path) =>
    Promise.resolve(
      path === employeesPath
        ? ok(employeePage([employeeItem(EMP_A, 7, null, 'Sara')], null))
        : path === versionsPath
          ? ok(versionPage([versionItem(EMP_A, 2), versionItem(EMP_A, 1)], 1))
          : path === blockedCorrectionsPath
            ? ok(blockedCorrectionPage([], null))
            : ok({}),
    ),
  );
  render(<CommissionPlansPage companyId={COMPANY} userId={USER} businessId={BUSINESS} />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>
    ),
  });
}

async function openEmployee() {
  fireEvent.change(await screen.findByLabelText('Employee'), { target: { value: EMP_A } });
  return screen.findByRole('table');
}

beforeEach(() => {
  api.GET.mockReset();
});

it('lays the page out as the list template: header, picker, the builder form, then the history card', async () => {
  renderPage();
  const table = await openEmployee();
  const heading = screen.getByRole('heading', { level: 1, name: 'Plan builder' });
  const shell = heading.closest('[data-page-shell="list"]') as HTMLElement;
  const picker = screen.getByLabelText('Employee');
  const save = await screen.findByRole('button', { name: 'Save plan' });
  const card = table.closest('.rounded-card') as HTMLElement;
  expect(shell.contains(card)).toBe(true);
  expect(card.contains(picker)).toBe(false);
  expect(card.contains(save)).toBe(false);
  expect(follows(heading, picker)).toBe(true);
  expect(follows(picker, save)).toBe(true);
  expect(follows(save, card)).toBe(true);
});

it('keeps the version table and the Load more footer inside one card, table first', async () => {
  renderPage();
  const table = await openEmployee();
  const card = table.closest('.rounded-card') as HTMLElement;
  expect(within(card).getByRole('heading', { level: 2, name: 'Plan versions' })).toBeTruthy();
  const loadMore = await within(card).findByRole('button', { name: 'Load more' });
  expect(follows(table, loadMore)).toBe(true);
});

it('stacks the rows under 600px and labels every cell after the version number', async () => {
  renderPage();
  const table = await openEmployee();
  expect(table.parentElement?.className).toContain(STACKED_CLASS);
  const row = screen.getAllByRole('row')[1] as HTMLElement;
  const cells = within(row).getAllByRole('cell');
  expect(cells.map((cell) => cell.getAttribute('data-cell-label'))).toEqual([
    null,
    'Effective from',
    'Whole period',
    'Plan',
    'Created at',
  ]);
  expect(cells[0]?.textContent).toBe('2');
});
