import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { createQueryClient } from '@/shared/api/query-client';
import { planEmployeesKey, planScope, planVersionsKey } from '../../api/plan-access';
import {
  deferredAnswer,
  EMP_A as EMP_A_ID,
  EMP_B as EMP_B_ID,
  emptyRefusal,
  employeeItem,
  employeePage,
  employeesPath,
  ok,
  refusal,
  routeGet,
  staffEmployeesPath,
  versionItem,
  versionPage,
  versionsPath,
  type ApiAnswer,
} from '../../api/__tests__/plan-http';
import { CommissionPlansRoute } from '../../../../app/(dashboard)/_frame/commission-plans-route';
import { VisibleIdsProbe } from '../../../../app/(dashboard)/_frame/menu/visible-ids-probe';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
const state = vi.hoisted(() => ({
  locale: 'en' as 'ar' | 'en',
  userId: 'user-a' as string | null,
  workspace: null as unknown,
}));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('@/shared/browser/use-mounted', () => ({ useMounted: () => true }));
vi.mock('@/session/api/use-session', () => ({ useSessionUser: () => state.userId }));
vi.mock('@/workspace/model/workspace-provider', () => ({ useWorkspace: () => state.workspace }));
vi.mock('next/navigation', () => ({ usePathname: () => '/commissions/plans' }));

const scope = planScope('company', 'business', 'user-a');
const EMP_A = employeeItem(EMP_A_ID, 7, 'سارة', 'Sara');
const EMP_B = employeeItem(EMP_B_ID, 9, null, 'Nada');
const B = {
  base: t('en', 'commissionPlanBuilder.blockBase'),
  bpsLabel: t('en', 'commissionPlanBuilder.bpsLabel'),
  save: t('en', 'commissionPlanBuilder.save'),
  navTitle: t('en', 'commissionPlanBuilder.navTitle'),
  tryAgain: t('en', 'commissionPlanBuilder.tryAgain'),
  pickerLabel: t('en', 'commissionPlanBuilder.pickerLabel'),
};

let client: QueryClient;

function workspaceFor(userId: string) {
  return {
    status: 'ready',
    company: {
      id: 'company',
      name_ar: null,
      name_en: 'Synthetic company',
      businesses: [],
      role_code: 'owner',
      scope: 'COMPANY',
    },
    business: { id: 'business', name_ar: null, name_en: 'Synthetic business', branches: [] },
    branch: undefined,
    companies: [],
    choose: vi.fn(),
    userId,
  };
}

/**
 * موجِّه بمسارات قابلة للتبديل قبل وبعدRender: كل طلب بيلتقي بموجِّه معرّف من الأول،
 * وتبديل الجواب بيأثر على الطلبات الجاية بس.
 */
function makeRouter() {
  const routes = new Map<
    string,
    (options?: { params?: { query?: Record<string, unknown> } }) => Promise<ApiAnswer>
  >();
  routeGet(api.GET, async (path, options) => {
    const handler = routes.get(path);
    if (handler === undefined) return deferredAnswer().promise;
    return handler(options);
  });
  return {
    on(path: string, handler: () => Promise<ApiAnswer>) {
      routes.set(path, () => handler());
    },
    onQuery(path: string, handler: (query?: Record<string, unknown>) => Promise<ApiAnswer>) {
      routes.set(path, (options) => handler(options?.params?.query));
    },
  };
}

function renderScreen() {
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(
    <>
      <VisibleIdsProbe />
      <CommissionPlansRoute />
    </>,
    { wrapper },
  );
}

function switchIdentity(userId: string, view: ReturnType<typeof renderScreen>) {
  state.userId = userId;
  state.workspace = workspaceFor(userId);
  view.rerender(
    <>
      <VisibleIdsProbe />
      <CommissionPlansRoute />
    </>,
  );
}

function picker(): HTMLSelectElement {
  return screen.getByLabelText(B.pickerLabel) as HTMLSelectElement;
}

async function chooseEmployee(id: string) {
  await screen.findByLabelText(B.pickerLabel);
  fireEvent.change(picker(), { target: { value: id } });
}

beforeEach(() => {
  api.GET.mockReset();
  api.POST.mockReset();
  state.locale = 'en';
  state.userId = 'user-a';
  state.workspace = workspaceFor('user-a');
  client = createQueryClient();
});

it('FR-010a: reaches the screen through the plan endpoint only and never the staff employees route', async () => {
  const router = makeRouter();
  const employeesRead = deferredAnswer();
  const versionsRead = deferredAnswer();
  router.on(employeesPath, () => employeesRead.promise);
  router.on(versionsPath, () => versionsRead.promise);
  renderScreen();
  employeesRead.resolve(ok(employeePage([EMP_A, EMP_B], null)));
  await chooseEmployee(EMP_A_ID);
  versionsRead.resolve(ok(versionPage([], null)));
  const save = (await screen.findByRole('button', { name: B.save })) as HTMLButtonElement;
  expect(save).toBeTruthy();
  const readPaths = api.GET.mock.calls.map((call) => call[0]);
  expect(readPaths.every((path) => path !== staffEmployeesPath)).toBe(true);
});

it('FR-010a: a 503 cursor refusal shows its own message, never the empty state', async () => {
  const router = makeRouter();
  const employeesRead = deferredAnswer();
  router.on(employeesPath, () => employeesRead.promise);
  renderScreen();
  employeesRead.resolve(refusal(503, 'COMMISSION_PLAN_EMPLOYEE_CURSOR_UNAVAILABLE'));
  expect(
    await screen.findByText(t('en', 'errors.COMMISSION_PLAN_EMPLOYEE_CURSOR_UNAVAILABLE')),
  ).toBeTruthy();
  expect(screen.queryByText(t('en', 'commissionPlanBuilder.listEmpty'))).toBeNull();
  expect(screen.queryByRole('link', { name: B.navTitle })).toBeNull();
});

it('P1-1a: a 403 on a later employees page removes names, numbers, link, picker and section, and empties the scope cache', async () => {
  const router = makeRouter();
  const firstPage = deferredAnswer();
  const versionsRead = deferredAnswer();
  const loadMore = deferredAnswer();
  router.onQuery(employeesPath, (query) =>
    query?.cursor === undefined ? firstPage.promise : loadMore.promise,
  );
  router.on(versionsPath, () => versionsRead.promise);
  renderScreen();
  firstPage.resolve(ok(employeePage([EMP_A], 'cursor-1')));
  await chooseEmployee(EMP_A_ID);
  versionsRead.resolve(ok(versionPage([], null)));
  await screen.findByRole('button', { name: B.save });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'commissionPlanBuilder.loadMore') }));
  loadMore.resolve(refusal(403, 'FORBIDDEN'));
  await screen.findByText(t('en', 'commissionPlanBuilder.deniedTitle'));
  expect(screen.queryByText('Sara — #7')).toBeNull();
  expect(screen.queryByRole('link', { name: B.navTitle })).toBeNull();
  expect(screen.queryByLabelText(B.pickerLabel)).toBeNull();
  expect(screen.queryByRole('button', { name: B.save })).toBeNull();
  expect(client.getQueryData(planEmployeesKey(scope))).toBeUndefined();
  expect(client.getQueryData(planVersionsKey(scope, EMP_A_ID))).toBeUndefined();
  const reads = api.GET.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(api.GET.mock.calls.length).toBe(reads);
});

it('P1-1b: returning to identity A shows nothing of A until A reads fresh, and a late old answer changes nothing', async () => {
  const router = makeRouter();
  const aEmployees = deferredAnswer();
  const aVersions = deferredAnswer();
  router.on(employeesPath, () => aEmployees.promise);
  router.on(versionsPath, () => aVersions.promise);
  const view = renderScreen();
  aEmployees.resolve(ok(employeePage([EMP_A], null)));
  await chooseEmployee(EMP_A_ID);
  switchIdentity('user-b', view);
  await new Promise((resolve) => setTimeout(resolve, 0));
  switchIdentity('user-a', view);
  expect(screen.queryByText('Sara — #7')).toBeNull();
  expect(screen.queryByRole('button', { name: B.save })).toBeNull();
  aVersions.resolve(ok(versionPage([versionItem(EMP_A_ID, 2)], null)));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByRole('button', { name: B.save })).toBeNull();
  expect(await screen.findByText('Sara — #7')).toBeTruthy();
});

it('P1-2i: a 403 from a version read closes the whole scope, spares the other identity and never loops', async () => {
  const router = makeRouter();
  const aEmployees = deferredAnswer();
  const aVersions = deferredAnswer();
  const nextVersions = deferredAnswer();
  let askVersions = aVersions;
  router.on(employeesPath, () => aEmployees.promise);
  router.on(versionsPath, () => askVersions.promise);
  renderScreen();
  aEmployees.resolve(ok(employeePage([EMP_A], null)));
  await chooseEmployee(EMP_A_ID);
  aVersions.resolve(ok(versionPage([], 12)));
  await screen.findByRole('button', { name: B.save });
  const otherIdentity = planScope('company', 'business', 'user-b');
  client.setQueryData(planEmployeesKey(otherIdentity), employeePage([EMP_B], null));
  client.setQueryData(
    planVersionsKey(otherIdentity, EMP_B_ID),
    versionPage([versionItem(EMP_B_ID, 5)], null),
  );
  askVersions = nextVersions;
  fireEvent.click(screen.getByRole('button', { name: t('en', 'commissionPlanBuilder.loadMore') }));
  nextVersions.resolve(refusal(403, 'FORBIDDEN'));
  await screen.findByText(t('en', 'commissionPlanBuilder.deniedTitle'));
  expect(screen.queryByRole('link', { name: B.navTitle })).toBeNull();
  expect(screen.queryByRole('button', { name: B.save })).toBeNull();
  expect(client.getQueryData(planEmployeesKey(scope))).toBeUndefined();
  expect(client.getQueryData(planVersionsKey(scope, EMP_A_ID))).toBeUndefined();
  expect(client.getQueryData(planEmployeesKey(otherIdentity))).not.toBeUndefined();
  expect(client.getQueryData(planVersionsKey(otherIdentity, EMP_B_ID))).not.toBeUndefined();
  const reads = api.GET.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(api.GET.mock.calls.length).toBe(reads);
  const retryEmployees = deferredAnswer();
  router.on(employeesPath, () => retryEmployees.promise);
  fireEvent.click(screen.getByRole('button', { name: B.tryAgain }));
  retryEmployees.resolve(ok(employeePage([EMP_A, EMP_B], null)));
  await screen.findByLabelText(B.pickerLabel);
  expect(picker().value).toBe('');
  expect(screen.queryByRole('button', { name: B.save })).toBeNull();
});

it('P1-2ii: a 403 from the save closes the whole scope and clears the held key', async () => {
  const router = makeRouter();
  const aEmployees = deferredAnswer();
  const aVersions = deferredAnswer();
  router.on(employeesPath, () => aEmployees.promise);
  router.on(versionsPath, () => aVersions.promise);
  renderScreen();
  aEmployees.resolve(ok(employeePage([EMP_A], null)));
  await chooseEmployee(EMP_A_ID);
  aVersions.resolve(ok(versionPage([], null)));
  const save = (await screen.findByRole('button', { name: B.save })) as HTMLButtonElement;
  const base = screen.getByRole('group', { name: B.base });
  fireEvent.click(within(base).getByRole('switch'));
  fireEvent.change(within(base).getByLabelText(B.bpsLabel), { target: { value: '500' } });
  await waitFor(() => expect(save.disabled).toBe(false));
  api.POST.mockResolvedValueOnce(refusal(403, 'FORBIDDEN'));
  fireEvent.click(save);
  await screen.findByText(t('en', 'commissionPlanBuilder.deniedTitle'));
  expect(screen.queryByRole('link', { name: B.navTitle })).toBeNull();
  expect(client.getQueryData([...scope, 'access'])).toMatchObject({ denied: true });
  await waitFor(() =>
    expect(client.getQueryData(planVersionsKey(scope, EMP_A_ID))).toBeUndefined(),
  );
});

it('FR-010a: a plan list 403 on a direct visit shows the denied state with no link', async () => {
  const router = makeRouter();
  const employeesRead = deferredAnswer();
  router.on(employeesPath, () => employeesRead.promise);
  renderScreen();
  employeesRead.resolve(refusal(403, 'FORBIDDEN'));
  await screen.findByText(t('en', 'commissionPlanBuilder.deniedTitle'));
  expect(screen.queryByRole('link', { name: B.navTitle })).toBeNull();
});

it('an employee 404 is local: the message shows and the list and the link remain', async () => {
  const router = makeRouter();
  const employeesRead = deferredAnswer();
  const versionsRead = deferredAnswer();
  router.on(employeesPath, () => employeesRead.promise);
  router.on(versionsPath, () => versionsRead.promise);
  renderScreen();
  employeesRead.resolve(ok(employeePage([EMP_A, EMP_B], null)));
  await chooseEmployee(EMP_A_ID);
  versionsRead.resolve(refusal(404, 'EMPLOYEE_NOT_FOUND'));
  expect(await screen.findByText(t('en', 'errors.EMPLOYEE_NOT_FOUND'))).toBeTruthy();
  expect(screen.getByLabelText(B.pickerLabel)).toBeTruthy();
  expect(screen.getByRole('link', { name: B.navTitle })).toBeTruthy();
  expect(screen.queryByText(t('en', 'commissionPlanBuilder.deniedTitle'))).toBeNull();
  const freshVersions = deferredAnswer();
  router.on(versionsPath, () => freshVersions.promise);
  fireEvent.change(picker(), { target: { value: EMP_B_ID } });
  freshVersions.resolve(ok(versionPage([], null)));
  expect(await screen.findByRole('button', { name: B.save })).toBeTruthy();
  expect(screen.queryByText(t('en', 'errors.EMPLOYEE_NOT_FOUND'))).toBeNull();
});

it('nav and page share one access state: deny reaches the nav through the page client', async () => {
  const router = makeRouter();
  const employeesRead = deferredAnswer();
  router.on(employeesPath, () => employeesRead.promise);
  renderScreen();
  employeesRead.resolve(ok(employeePage([EMP_A], null)));
  const link = await screen.findByRole('link', { name: B.navTitle });
  expect(link.getAttribute('href')).toBe('/commissions/plans');
  const deny = await import('../../api/plan-access');
  await act(async () => {
    await deny.denyPlanAccess(client, scope);
  });
  await waitFor(() => expect(screen.queryByRole('link', { name: B.navTitle })).toBeNull());
});

it('a 403 with an empty body closes the whole scope like any other 403', async () => {
  const router = makeRouter();
  const employeesRead = deferredAnswer();
  router.on(employeesPath, () => employeesRead.promise);
  renderScreen();
  employeesRead.resolve(emptyRefusal(403));
  await screen.findByText(t('en', 'commissionPlanBuilder.deniedTitle'));
  expect(screen.queryByRole('link', { name: B.navTitle })).toBeNull();
  expect(screen.queryByLabelText(B.pickerLabel)).toBeNull();
  const reads = api.GET.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(api.GET.mock.calls.length).toBe(reads);
});

it('a 404 with an empty body on the versions read is the local employee-not-found', async () => {
  const router = makeRouter();
  const employeesRead = deferredAnswer();
  const versionsRead = deferredAnswer();
  router.on(employeesPath, () => employeesRead.promise);
  router.on(versionsPath, () => versionsRead.promise);
  renderScreen();
  employeesRead.resolve(ok(employeePage([EMP_A], null)));
  await chooseEmployee(EMP_A_ID);
  versionsRead.resolve(emptyRefusal(404));
  // الجسم الفاضي مفيش فيه كود، فالرسالة العامة، بس المعالجة المحلية: تنبيه مكان المحرّر من غير قفل نطاق.
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByLabelText(B.pickerLabel)).toBeTruthy();
  expect(screen.getByRole('link', { name: B.navTitle })).toBeTruthy();
  expect(screen.queryByText(t('en', 'commissionPlanBuilder.deniedTitle'))).toBeNull();
});

it('a 500 with an empty body shows the generic error, never a denied state', async () => {
  const router = makeRouter();
  const employeesRead = deferredAnswer();
  const versionsRead = deferredAnswer();
  router.on(employeesPath, () => employeesRead.promise);
  router.on(versionsPath, () => versionsRead.promise);
  renderScreen();
  employeesRead.resolve(ok(employeePage([EMP_A], null)));
  await chooseEmployee(EMP_A_ID);
  versionsRead.resolve(emptyRefusal(500));
  expect(await screen.findByText(t('en', 'admin.unexpected'))).toBeTruthy();
  expect(screen.getByLabelText(B.pickerLabel)).toBeTruthy();
  expect(screen.queryByText(t('en', 'commissionPlanBuilder.deniedTitle'))).toBeNull();
});

it('a failed background employees refetch keeps the picker and the link; only a 403 hides them', async () => {
  const router = makeRouter();
  const employeesRead = deferredAnswer();
  const versionsRead = deferredAnswer();
  router.on(employeesPath, () => employeesRead.promise);
  router.on(versionsPath, () => versionsRead.promise);
  renderScreen();
  employeesRead.resolve(ok(employeePage([EMP_A], null)));
  await chooseEmployee(EMP_A_ID);
  versionsRead.resolve(ok(versionPage([], null)));
  await screen.findByRole('button', { name: B.save });
  // إعادة جلب خلفية فشلت بعد أول صفحة ناجحة: الرسالة بتظهر واللينك واللقطة بيفضلوا موجودين.
  const failedRefetch = deferredAnswer();
  router.on(employeesPath, () => failedRefetch.promise);
  await act(async () => {
    const refetching = client.refetchQueries({ queryKey: planEmployeesKey(scope) });
    failedRefetch.resolve(refusal(500, 'INTERNAL'));
    await refetching;
  });
  expect(await screen.findByText('Synthetic refusal')).toBeTruthy();
  expect(screen.getByLabelText(B.pickerLabel)).toBeTruthy();
  expect(screen.getByRole('link', { name: B.navTitle })).toBeTruthy();
  expect(screen.queryByText(t('en', 'commissionPlanBuilder.deniedTitle'))).toBeNull();
  // 403 في إعادة الجلب هو الوحيد اللي بيخفيهم.
  const denyingRefetch = deferredAnswer();
  router.on(employeesPath, () => denyingRefetch.promise);
  await act(async () => {
    const refetching = client.refetchQueries({ queryKey: planEmployeesKey(scope) });
    denyingRefetch.resolve(refusal(403, 'FORBIDDEN'));
    await refetching;
  });
  await screen.findByText(t('en', 'commissionPlanBuilder.deniedTitle'));
  expect(screen.queryByLabelText(B.pickerLabel)).toBeNull();
  expect(screen.queryByRole('link', { name: B.navTitle })).toBeNull();
});
