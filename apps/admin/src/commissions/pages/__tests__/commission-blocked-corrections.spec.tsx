import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { createQueryClient } from '@/shared/api/query-client';
import {
  blockedCorrectionItem,
  blockedCorrectionPage,
  blockedCorrectionsPath,
  BUSINESS,
  COMPANY,
  EMP_A,
  EMP_B,
  employeeItem,
  employeePage,
  employeesPath,
  ok,
  refusal,
  routeGet,
  USER,
  versionItem,
  versionPage,
  versionsPath,
  type ApiAnswer,
} from '../../api/__tests__/plan-http';
import { stampDate } from '../../ui/plan-history-columns';
import { CommissionPlansPage } from '../commission-plans-page';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));

const P = (key: string) => t('en', `commissionPlanBuilder.${key}` as never);
const BLOCK_1 = '01920000-0000-7000-8000-00000000b101';
const BLOCK_2 = '01920000-0000-7000-8000-00000000b102';
const BLOCK_3 = '01920000-0000-7000-8000-00000000b103';

type BlockedQuery = { status?: string; cursor?: string };
const lists = {
  open: [] as unknown[],
  resolved: [] as unknown[],
  all: [] as unknown[],
  nextCursor: null as string | null,
  page2: [] as unknown[],
};

function serve() {
  routeGet(api.GET, async (path, options): Promise<ApiAnswer> => {
    if (path === employeesPath)
      return ok(employeePage([employeeItem(EMP_A, 7, null, 'Sara')], null));
    if (path === versionsPath) return ok(versionPage([], null));
    if (path === blockedCorrectionsPath) {
      const query = (options?.params?.query ?? {}) as BlockedQuery;
      if (query.cursor !== undefined) return ok(blockedCorrectionPage(lists.page2, null));
      const items = lists[(query.status ?? 'open') as 'open' | 'resolved' | 'all'];
      return ok(blockedCorrectionPage(items, lists.nextCursor));
    }
    return ok({});
  });
}

function renderPage() {
  render(<CommissionPlansPage companyId={COMPANY} userId={USER} businessId={BUSINESS} />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>
    ),
  });
}

const openPlan = blockedCorrectionItem(BLOCK_1, EMP_A);
const openSalary = blockedCorrectionItem(BLOCK_2, EMP_B, { code: 'NO_SALARY', source_period: '2026-08' });
const resolvedRow = blockedCorrectionItem(BLOCK_3, EMP_A, {
  source_period: '2026-07',
  resolved_at: '2026-11-05T09:00:00Z',
});

beforeEach(() => {
  api.GET.mockReset();
  api.POST.mockReset();
  lists.open = [openPlan, openSalary];
  lists.resolved = [resolvedRow];
  lists.all = [openPlan, openSalary, resolvedRow];
  lists.nextCursor = null;
  lists.page2 = [];
  serve();
});

afterEach(cleanup);

async function openRepairDialog() {
  fireEvent.click(await screen.findByRole('button', { name: P('blockedRepair') }));
  return screen.findByRole('dialog');
}

function fillBasePercentage(dialog: HTMLElement, bps: string) {
  fireEvent.click(within(dialog).getByRole('switch', { name: P('blockBase') }));
  fireEvent.change(within(dialog).getAllByLabelText(P('bpsLabel'))[0] as HTMLElement, {
    target: { value: bps },
  });
}

async function submitRepair(dialog: HTMLElement) {
  const save = within(dialog).getByRole('button', { name: P('repairSubmit') }) as HTMLButtonElement;
  await waitFor(() => expect(save.disabled).toBe(false));
  fireEvent.click(save);
}

const repairBody = {
  period: '2026-09',
  plan: {
    base: { enabled: true, calc: { kind: 'PCT', bps: 500 } },
    tiers: { enabled: false },
    package_sale: { enabled: false },
  },
};

function repairAnswer(resolved: boolean, code: 'NO_PLAN' | 'NO_SALARY') {
  return ok({
    version: versionItem(EMP_A, 3, {
      effective_from: '2026-09-01',
      whole_period: true,
      repair_period: '2026-09',
    }),
    blocked_correction: { id: BLOCK_1, code, resolved },
  });
}

it('lists the open blocked corrections by default, with employee name, month, reason and the right action per reason', async () => {
  renderPage();
  const table = await screen.findByRole('table');
  expect(api.GET).toHaveBeenCalledWith(
    blockedCorrectionsPath,
    expect.objectContaining({ params: expect.objectContaining({ query: { status: 'open', limit: 20 } }) }),
  );
  const [planRow, salaryRow] = within(table).getAllByRole('row').slice(1);
  const planCells = within(planRow as HTMLElement).getAllByRole('cell');
  expect(planCells[0]?.textContent).toBe('Sara — #7');
  expect(planCells[1]?.textContent).toBe('2026-09');
  expect(planCells[2]?.textContent).toBe(P('blockedCodeNoPlan'));
  expect(within(planRow as HTMLElement).getByRole('button', { name: P('blockedRepair') })).toBeTruthy();
  const salaryCells = within(salaryRow as HTMLElement).getAllByRole('cell');
  expect(salaryCells[0]?.textContent).toBe(EMP_B);
  expect(salaryCells[2]?.textContent).toBe(P('blockedCodeNoSalary'));
  expect(within(salaryRow as HTMLElement).queryByRole('button')).toBeNull();
  expect(within(salaryRow as HTMLElement).getByText(P('blockedSalaryNote'))).toBeTruthy();
});

it('shows an empty message and no table when nothing is blocked', async () => {
  lists.open = [];
  renderPage();
  expect(await screen.findByText(P('blockedEmpty'))).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
});

it('switches the filter to resolved and shows the resolution time without an action', async () => {
  renderPage();
  await screen.findByRole('table');
  fireEvent.change(screen.getByLabelText(P('blockedFilterLabel')), { target: { value: 'resolved' } });
  const stamp = stampDate('2026-11-05T09:00:00Z', 'en', 'Asia/Kuwait');
  const cell = await screen.findByText(stamp);
  const row = cell.closest('tr') as HTMLElement;
  expect(within(row).getAllByRole('cell')[1]?.textContent).toBe('2026-07');
  expect(within(row).queryByRole('button')).toBeNull();
  expect(api.GET).toHaveBeenCalledWith(
    blockedCorrectionsPath,
    expect.objectContaining({ params: expect.objectContaining({ query: { status: 'resolved', limit: 20 } }) }),
  );
});

it('shows every status under the all filter', async () => {
  renderPage();
  await screen.findByRole('table');
  fireEvent.change(screen.getByLabelText(P('blockedFilterLabel')), { target: { value: 'all' } });
  await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(4));
});

it('loads the next page with the cursor and appends its rows after the first page', async () => {
  lists.open = [openPlan];
  lists.nextCursor = 'next-page';
  lists.page2 = [openSalary];
  renderPage();
  await screen.findByRole('table');
  expect(screen.getAllByRole('row')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: P('loadMore') }));
  await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3));
  expect(api.GET).toHaveBeenCalledWith(
    blockedCorrectionsPath,
    expect.objectContaining({
      params: expect.objectContaining({ query: { status: 'open', limit: 20, cursor: 'next-page' } }),
    }),
  );
  expect(screen.queryByRole('button', { name: P('loadMore') })).toBeNull();
});

it('repairs a NO_PLAN month: sends the plan with the month and key, then says the month was repaired', async () => {
  api.POST.mockResolvedValue(repairAnswer(true, 'NO_PLAN'));
  renderPage();
  const dialog = await openRepairDialog();
  expect(within(dialog).getByText('Sara — #7')).toBeTruthy();
  expect(within(dialog).getByText('2026-09')).toBeTruthy();
  expect(within(dialog).queryByLabelText(P('effectiveFrom'))).toBeNull();
  fillBasePercentage(dialog, '500');
  await submitRepair(dialog);
  expect((await within(dialog).findByRole('status')).textContent).toBe(P('repairResolved'));
  const [path, options] = api.POST.mock.calls[0] as [string, { body: unknown; params: { header: Record<string, string> } }];
  expect(path).toBe('/v1/businesses/{businessId}/employees/{employeeId}/commission-period-repairs');
  expect(options.body).toEqual(repairBody);
  expect(options.params.header['Idempotency-Key']).toMatch(/[0-9a-f-]{36}/);
});

it('CM-52b: tells the manager the plan was saved but the block now waits for a salary', async () => {
  api.POST.mockResolvedValue(repairAnswer(false, 'NO_SALARY'));
  renderPage();
  const dialog = await openRepairDialog();
  fillBasePercentage(dialog, '500');
  await submitRepair(dialog);
  expect((await within(dialog).findByRole('status')).textContent).toBe(P('repairNoSalary'));
});

it('shows the not-allowed refusal in the dialog and keeps the form for another try', async () => {
  api.POST.mockResolvedValue(refusal(422, 'COMMISSION_REPAIR_NOT_ALLOWED'));
  renderPage();
  const dialog = await openRepairDialog();
  fillBasePercentage(dialog, '500');
  await submitRepair(dialog);
  expect((await within(dialog).findByRole('alert')).textContent).toBe(
    t('en', 'errors.COMMISSION_REPAIR_NOT_ALLOWED'),
  );
  expect(within(dialog).getByRole('button', { name: P('repairSubmit') })).toBeTruthy();
});

it('shows an invalid-plan refusal from the server on the form', async () => {
  api.POST.mockResolvedValue({
    error: {
      code: 'COMMISSION_PLAN_INVALID',
      details: { code: 'NO_STEPS' },
      message_ar: 'x',
      message_en: 'x',
    },
    response: { status: 422, ok: false },
  });
  renderPage();
  const dialog = await openRepairDialog();
  fillBasePercentage(dialog, '500');
  await submitRepair(dialog);
  expect((await within(dialog).findByRole('alert')).textContent).toBe(
    t('en', 'commissionPlanBuilder.errorNoSteps'),
  );
});

it('locks the whole screen on a 403 from the repair', async () => {
  api.POST.mockResolvedValue(refusal(403, 'FORBIDDEN'));
  renderPage();
  const dialog = await openRepairDialog();
  fillBasePercentage(dialog, '500');
  await submitRepair(dialog);
  expect(await screen.findByText(P('deniedTitle'))).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
});

it('locks the whole screen when the blocked-corrections list itself answers 403', async () => {
  routeGet(api.GET, async (path) => {
    if (path === employeesPath)
      return ok(employeePage([employeeItem(EMP_A, 7, null, 'Sara')], null));
    if (path === blockedCorrectionsPath) return refusal(403, 'FORBIDDEN');
    return ok({});
  });
  renderPage();
  expect(await screen.findByText(P('deniedTitle'))).toBeTruthy();
  expect(screen.queryByText(P('blockedTitle'))).toBeNull();
});
