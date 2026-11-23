import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/shared/api/query-client';
import {
  COMPANY,
  BUSINESS,
  EMP_A,
  USER,
  employeeItem,
  employeePage,
  employeesPath,
  ok,
} from '../../api/__tests__/plan-http';
import {
  CURSOR,
  makeOverrideRouter,
  overrideItem,
  overrideServicesPath,
  SERVICE_A,
  SERVICE_B,
  serviceItem,
  servicePage,
} from '../../api/__tests__/override-http';
import { CommissionOverridesPage } from '../commission-overrides-page';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));

// الإطار يضيف أصناف التكديس على غلاف الجدول فقط عند تفعيل stacked؛ لا شيء مرئيًا يميّزها في jsdom.
const STACKED_CLASS = 'max-[599.99px]:[&_table]:block';

function follows(first: Node, second: Node) {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function renderPage() {
  const router = makeOverrideRouter(api.GET);
  router.on(employeesPath, () =>
    Promise.resolve(ok(employeePage([employeeItem(EMP_A, 7, null, 'Sara')], null))),
  );
  router.on(overrideServicesPath, () =>
    Promise.resolve(
      ok(
        servicePage(
          [
            serviceItem(SERVICE_A, {
              current_override: overrideItem(SERVICE_A, {
                rule: { kind: 'PCT', value: 1500 },
                effective_from: '2026-03-01',
              }),
            }),
            serviceItem(SERVICE_B),
          ],
          CURSOR,
        ),
      ),
    ),
  );
  render(<CommissionOverridesPage companyId={COMPANY} userId={USER} businessId={BUSINESS} />, {
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

it('lays the page out as the list template: header first, then the picker, then the card', async () => {
  renderPage();
  const table = await openEmployee();
  const heading = screen.getByRole('heading', {
    level: 1,
    name: 'Special commission for one service',
  });
  const shell = heading.closest('[data-page-shell="list"]') as HTMLElement;
  const picker = screen.getByLabelText('Employee');
  const card = table.closest('.rounded-card') as HTMLElement;
  expect(shell.contains(card)).toBe(true);
  expect(card.contains(picker)).toBe(false);
  expect(follows(heading, picker)).toBe(true);
  expect(follows(picker, card)).toBe(true);
});

it('keeps the table and the Load more footer inside one card, table first', async () => {
  renderPage();
  const table = await openEmployee();
  const card = table.closest('.rounded-card') as HTMLElement;
  const loadMore = await within(card).findByRole('button', { name: 'Load more' });
  expect(follows(table, loadMore)).toBe(true);
  expect(screen.getAllByRole('button', { name: 'Load more' })).toHaveLength(1);
});

it('stacks the rows under 600px and labels every cell that has content', async () => {
  renderPage();
  const table = await openEmployee();
  expect(table.parentElement?.className).toContain(STACKED_CLASS);
  const row = screen.getAllByRole('row')[1] as HTMLElement;
  const cells = within(row).getAllByRole('cell');
  expect(cells.map((cell) => cell.getAttribute('data-cell-label'))).toEqual([
    null,
    'Price (KWD, 3 decimals)',
    'Service commission',
    'Special commission',
    null,
  ]);
  expect(cells[0]?.textContent).toContain('Service 3');
  expect(within(cells[4] as HTMLElement).getByRole('button', { name: 'Edit' })).toBeTruthy();
});
