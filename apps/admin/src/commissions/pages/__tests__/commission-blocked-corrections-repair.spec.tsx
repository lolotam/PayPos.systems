import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { createQueryClient } from '@/shared/api/query-client';
import { denyPlanAccess, planScope } from '../../api/plan-access';
import {
  blockedCorrectionItem,
  blockedCorrectionPage,
  blockedCorrectionsPath,
  BUSINESS,
  COMPANY,
  deferredAnswer,
  EMP_A,
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
import { CommissionPlansPage } from '../commission-plans-page';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));

const P = (key: string) => t('en', `commissionPlanBuilder.${key}` as never);
const BLOCK_1 = '01920000-0000-7000-8000-00000000b101';
const BLOCK_2 = '01920000-0000-7000-8000-00000000b102';
const scope = planScope(COMPANY, BUSINESS, USER);

const openPlan = blockedCorrectionItem(BLOCK_1, EMP_A);
const otherOpen = blockedCorrectionItem(BLOCK_2, EMP_A, { source_period: '2026-08' });
const server = { open: [] as unknown[], versions: [] as unknown[] };
let client: QueryClient;

function serve() {
  routeGet(api.GET, async (path): Promise<ApiAnswer> => {
    if (path === employeesPath) return ok(employeePage([employeeItem(EMP_A, 7, null, 'Sara')], null));
    if (path === versionsPath) return ok(versionPage(server.versions, null));
    if (path === blockedCorrectionsPath) return ok(blockedCorrectionPage(server.open, null));
    return ok({});
  });
}

function renderPage() {
  render(<CommissionPlansPage companyId={COMPANY} userId={USER} businessId={BUSINESS} />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  api.GET.mockReset();
  api.POST.mockReset();
  client = createQueryClient();
  server.open = [openPlan, otherOpen];
  server.versions = [];
  serve();
});

afterEach(cleanup);

async function openRepairDialog() {
  fireEvent.click((await screen.findAllByRole('button', { name: P('blockedRepair') }))[0] as HTMLElement);
  return screen.findByRole('dialog');
}

const saveButton = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: P('repairSubmit') }) as HTMLButtonElement;

function setBasePercentage(dialog: HTMLElement, bps: string, enable = true) {
  if (enable) fireEvent.click(within(dialog).getByRole('switch', { name: P('blockBase') }));
  // الـ ids ثابتة في بلوكات الخطة، فمع نموذج الخطة المفتوح ورا الحوار الـ label بيشاور على أول واحد؛ فبنوصل للحقل بدوره.
  fireEvent.change(within(dialog).getAllByRole('textbox')[0] as HTMLElement, {
    target: { value: bps },
  });
}

async function submit(dialog: HTMLElement) {
  await waitFor(() => expect(saveButton(dialog).disabled).toBe(false));
  fireEvent.click(saveButton(dialog));
}

const answer = (resolved: boolean, code: 'NO_PLAN' | 'NO_SALARY') =>
  ok({
    version: versionItem(EMP_A, 3, {
      effective_from: '2026-09-01',
      whole_period: true,
      repair_period: '2026-09',
    }),
    blocked_correction: { id: BLOCK_1, code, resolved },
  });

const rowsOfBlocked = () => screen.getAllByRole('row').length - 1;
const keyOf = (call: unknown[]) =>
  (call[1] as { params: { header: Record<string, string> } }).params.header['Idempotency-Key'];
const reads = (path: string) => api.GET.mock.calls.filter((call) => call[0] === path).length;

it('GR-001: opens with Save disabled, and only an explicit zero-commission confirmation enables an all-off repair', async () => {
  api.POST.mockResolvedValue(answer(true, 'NO_PLAN'));
  renderPage();
  const dialog = await openRepairDialog();
  expect(saveButton(dialog).disabled).toBe(true);
  fireEvent.click(within(dialog).getByLabelText(P('repairConfirmZero')));
  await submit(dialog);
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
  const [, options] = api.POST.mock.calls[0] as [string, { body: { plan: unknown } }];
  expect(options.body.plan).toEqual({
    base: { enabled: false },
    tiers: { enabled: false },
    package_sale: { enabled: false },
  });
});

it('GR-001: enabling a valid block enables Save at once and hides the zero-commission confirmation', async () => {
  renderPage();
  const dialog = await openRepairDialog();
  expect(within(dialog).getByLabelText(P('repairConfirmZero'))).toBeTruthy();
  setBasePercentage(dialog, '500');
  await waitFor(() => expect(saveButton(dialog).disabled).toBe(false));
  expect(within(dialog).queryByLabelText(P('repairConfirmZero'))).toBeNull();
});

it('lists the open rows again without the repaired one after a resolved repair', async () => {
  api.POST.mockImplementation(async () => {
    server.open = [otherOpen];
    return answer(true, 'NO_PLAN');
  });
  renderPage();
  await screen.findByRole('table');
  expect(rowsOfBlocked()).toBe(2);
  const dialog = await openRepairDialog();
  setBasePercentage(dialog, '500');
  await submit(dialog);
  await within(dialog).findByText(P('repairResolved'));
  fireEvent.click(within(dialog).getByRole('button', { name: P('repairClose') }));
  await waitFor(() => expect(rowsOfBlocked()).toBe(1));
});

it('CM-52b: after a repair that leaves NO_SALARY the row shows the salary note and no Repair button', async () => {
  server.open = [openPlan];
  api.POST.mockImplementation(async () => {
    server.open = [{ ...openPlan, code: 'NO_SALARY' }];
    return answer(false, 'NO_SALARY');
  });
  renderPage();
  const dialog = await openRepairDialog();
  setBasePercentage(dialog, '500');
  await submit(dialog);
  await within(dialog).findByText(P('repairNoSalary'));
  fireEvent.click(within(dialog).getByRole('button', { name: P('repairClose') }));
  expect(await screen.findByText(P('blockedSalaryNote'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: P('blockedRepair') })).toBeNull();
  expect(screen.getByText(P('blockedCodeNoSalary'))).toBeTruthy();
});

it('keeps the idempotency key when the same body is retried and takes a new one when the body changes', async () => {
  api.POST.mockResolvedValue(refusal(500, 'INTERNAL'));
  renderPage();
  const dialog = await openRepairDialog();
  setBasePercentage(dialog, '500');
  await submit(dialog);
  await within(dialog).findByRole('alert');
  await submit(dialog);
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
  setBasePercentage(dialog, '600', false);
  await submit(dialog);
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(3));
  const [first, second, third] = api.POST.mock.calls.map(keyOf);
  expect(second).toBe(first);
  expect(third).not.toBe(first);
});

it('ignores a repair answer that arrives after the identity was locked: the screen stays denied', async () => {
  const post = deferredAnswer();
  api.POST.mockReturnValue(post.promise);
  renderPage();
  const dialog = await openRepairDialog();
  setBasePercentage(dialog, '500');
  await submit(dialog);
  await act(async () => {
    await denyPlanAccess(client, scope);
  });
  await screen.findByText(P('deniedTitle'));
  const before = reads(blockedCorrectionsPath);
  await act(async () => {
    post.resolve(answer(true, 'NO_PLAN'));
    await post.promise;
  });
  expect(screen.getByText(P('deniedTitle'))).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
  expect(reads(blockedCorrectionsPath)).toBe(before);
});

it('ignores a blocked-list answer that arrives after the identity was locked', async () => {
  const list = deferredAnswer();
  routeGet(api.GET, async (path) => {
    if (path === employeesPath) return ok(employeePage([employeeItem(EMP_A, 7, null, 'Sara')], null));
    if (path === blockedCorrectionsPath) return list.promise;
    return ok({});
  });
  renderPage();
  await screen.findByText(P('blockedLoading'));
  await act(async () => {
    await denyPlanAccess(client, scope);
  });
  await screen.findByText(P('deniedTitle'));
  await act(async () => {
    list.resolve(ok(blockedCorrectionPage([openPlan], null)));
    await list.promise;
  });
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByText(P('blockedTitle'))).toBeNull();
});

it('prepends the repair version to the loaded history without refetching it', async () => {
  server.versions = [versionItem(EMP_A, 2)];
  renderPage();
  fireEvent.change(await screen.findByLabelText(P('pickerLabel')), { target: { value: EMP_A } });
  const table = (await screen.findByText(P('colVersion'))).closest('table') as HTMLElement;
  expect(within(table).getAllByRole('row')).toHaveLength(2);
  const before = reads(versionsPath);
  api.POST.mockResolvedValue(answer(true, 'NO_PLAN'));
  const dialog = await openRepairDialog();
  setBasePercentage(dialog, '500');
  await submit(dialog);
  await within(dialog).findByText(P('repairResolved'));
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows).toHaveLength(2);
  expect(within(rows[0] as HTMLElement).getAllByRole('cell')[0]?.textContent).toBe(
    `3 · ${P('repairOf')} 2026-09`,
  );
  expect(reads(versionsPath)).toBe(before);
});

it('N-5: refreshes the open list when the server says the repair is no longer allowed', async () => {
  api.POST.mockResolvedValue(refusal(422, 'COMMISSION_REPAIR_NOT_ALLOWED'));
  renderPage();
  await screen.findByRole('table');
  const before = reads(blockedCorrectionsPath);
  const dialog = await openRepairDialog();
  setBasePercentage(dialog, '500');
  await submit(dialog);
  await within(dialog).findByRole('alert');
  await waitFor(() => expect(reads(blockedCorrectionsPath)).toBeGreaterThan(before));
});
