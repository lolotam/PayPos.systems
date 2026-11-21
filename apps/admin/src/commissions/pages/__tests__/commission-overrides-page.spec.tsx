import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { createQueryClient } from '@/shared/api/query-client';
import { planOverrideServicesKey, planScope } from '../../api/plan-access';
import {
  deferredAnswer,
  EMP_A as EMP_A_ID,
  EMP_B as EMP_B_ID,
  employeeItem,
  employeePage,
  employeesPath,
  ok,
  refusal,
  routeGet,
  type ApiAnswer,
} from '../../api/__tests__/plan-http';
import {
  CURSOR,
  overrideItem,
  overridePage,
  overrideServicesPath,
  overridesPath,
  SERVICE_A,
  SERVICE_B,
  serviceItem,
  servicePage,
} from '../../api/__tests__/override-http';
import { CommissionOverridesRoute } from '../../../../app/(dashboard)/_frame/commission-overrides-route';
import { CommissionPlansNavItem } from '../../../../app/(dashboard)/_frame/commission-plans-nav-item';

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
vi.mock('next/navigation', () => ({ usePathname: () => '/commissions/overrides' }));

const scope = planScope('company', 'business', 'user-a');
const L = {
  denied: t('en', 'commissionPlanBuilder.deniedTitle'),
  nav: t('en', 'commissionOverrides.navTitle'),
  edit: t('en', 'commissionOverrides.edit'),
  save: t('en', 'commissionOverrides.save'),
  saved: t('en', 'commissionOverrides.saved'),
  bps: t('en', 'commissionOverrides.bpsLabel'),
  noOverride: t('en', 'commissionOverrides.noOverride'),
  current: t('en', 'commissionOverrides.currentBadge'),
  empty: t('en', 'commissionOverrides.emptyTitle'),
  loadMore: t('en', 'commissionOverrides.loadMore'),
  couldNot: t('en', 'commissionOverrides.couldNotLoadMore'),
  employeeMissing: t('en', 'errors.EMPLOYEE_NOT_FOUND'),
  chooseBusiness: t('en', 'admin.chooseBusiness'),
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

interface RouteOptions {
  params?: { path?: Record<string, unknown>; query?: Record<string, unknown> };
}

/** موجِّه بمسارات قابلة للتبديل: كل مسار بيتعامل معاه handler ويقدر يرجع جواب مؤجّل. */
function makeRouter() {
  const routes = new Map<string, (options?: RouteOptions) => Promise<ApiAnswer>>();
  routeGet(api.GET, async (path, options) => {
    const handler = routes.get(path);
    if (handler === undefined) return deferredAnswer().promise;
    return handler(options as RouteOptions | undefined);
  });
  return {
    on(path: string, handler: (options?: RouteOptions) => Promise<ApiAnswer>) {
      routes.set(path, handler);
    },
  };
}

function renderScreen() {
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(
    <>
      <CommissionPlansNavItem />
      <CommissionOverridesRoute />
    </>,
    { wrapper },
  );
}

async function chooseEmployee(id: string) {
  const picker = await screen.findByLabelText(t(state.locale, 'commissionPlanBuilder.pickerLabel'));
  fireEvent.change(picker, { target: { value: id } });
}

beforeEach(() => {
  api.GET.mockReset();
  api.POST.mockReset();
  state.locale = 'en';
  state.userId = 'user-a';
  state.workspace = workspaceFor('user-a');
  client = createQueryClient();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

it('CM-11: saving PCT 1500 on صبغة shows saved, refreshes the row and tops the history', async () => {
  state.locale = 'ar';
  const router = makeRouter();
  router.on(employeesPath, () =>
    Promise.resolve(ok(employeePage([employeeItem(EMP_A_ID, 7, 'سارة', 'Sara')], null))),
  );
  router.on(overrideServicesPath, () =>
    Promise.resolve(
      ok(servicePage([serviceItem(SERVICE_A, { name_ar: 'صبغة', name_en: 'Dyeing' })], null)),
    ),
  );
  router.on(overridesPath, () => Promise.resolve(ok(overridePage([overrideItem(SERVICE_A)], null))));
  api.POST.mockResolvedValue(ok(overrideItem(SERVICE_A)));
  renderScreen();
  await chooseEmployee(EMP_A_ID);
  fireEvent.click(await screen.findByRole('button', { name: t('ar', 'commissionOverrides.edit') }));
  const bps = await screen.findByLabelText(t('ar', 'commissionOverrides.bpsLabel'));
  fireEvent.change(bps, { target: { value: '1500' } });
  const save = screen.getByRole('button', { name: t('ar', 'commissionOverrides.save') });
  await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(save);
  expect(await screen.findByText(t('ar', 'commissionOverrides.saved'))).toBeTruthy();
  expect(api.POST.mock.calls[0]?.[1].body).toEqual({
    service_id: SERVICE_A,
    rule: { kind: 'PCT', value: 1500 },
    effective_from: '2026-11-21',
  });
});

it('FR-013a: the table shows name, price, service commission and override from the three commission paths only', async () => {
  const router = makeRouter();
  router.on(employeesPath, () =>
    Promise.resolve(ok(employeePage([employeeItem(EMP_A_ID, 7, null, 'Sara')], null))),
  );
  router.on(overrideServicesPath, () =>
    Promise.resolve(
      ok(
        servicePage(
          [
            serviceItem(SERVICE_A, {
              name_ar: 'صبغة',
              name_en: 'Dyeing',
              price: '25.000',
              service_rule: { kind: 'PCT', value: 1000 },
              current_override: null,
            }),
          ],
          null,
        ),
      ),
    ),
  );
  router.on(overridesPath, () => Promise.resolve(ok(overridePage([], null))));
  renderScreen();
  await chooseEmployee(EMP_A_ID);
  const row = (await screen.findByText('Dyeing')).closest('tr');
  expect(row).toBeTruthy();
  const cells = within(row as HTMLElement).getAllByRole('cell');
  expect(cells[0]?.textContent).toContain('Dyeing');
  expect(cells[1]?.textContent).toContain('25.000');
  expect(cells[2]?.textContent).toContain('10.00%');
  expect(cells[3]?.textContent).toContain(L.noOverride);
  const readPaths = api.GET.mock.calls.map((call) => call[0]);
  expect(readPaths).not.toContain('/v1/businesses/{businessId}/services');
  expect(readPaths).toContain(overrideServicesPath);
});

it('CM-13: a direct visit with a plan-list 403 shows the denied state, no links and no services request', async () => {
  const router = makeRouter();
  router.on(employeesPath, () => Promise.resolve(refusal(403, 'FORBIDDEN')));
  renderScreen();
  expect(await screen.findByText(L.denied)).toBeTruthy();
  expect(screen.queryByRole('link', { name: L.nav })).toBeNull();
  const readPaths = api.GET.mock.calls.map((call) => call[0]);
  expect(readPaths).not.toContain(overrideServicesPath);
});

it('the route shows choose-business without a business and nothing without a user', async () => {
  const router = makeRouter();
  router.on(employeesPath, () => Promise.resolve(ok(employeePage([], null))));
  state.workspace = { ...workspaceFor('user-a'), business: undefined };
  const view = renderScreen();
  expect(await screen.findByText(L.chooseBusiness)).toBeTruthy();
  state.userId = null;
  await act(async () => {
    view.rerender(
      <>
        <CommissionPlansNavItem />
        <CommissionOverridesRoute />
      </>,
    );
  });
  expect(screen.queryByText(L.chooseBusiness)).toBeNull();
  expect(screen.queryByLabelText(t('en', 'commissionPlanBuilder.pickerLabel'))).toBeNull();
});

it('a 403 from the history read closes the scope and the open dialog, ignores a late answer and drops the held key', async () => {
  const router = makeRouter();
  const history = deferredAnswer();
  router.on(employeesPath, () =>
    Promise.resolve(ok(employeePage([employeeItem(EMP_A_ID, 7, null, 'Sara')], null))),
  );
  router.on(overrideServicesPath, () => Promise.resolve(ok(servicePage([serviceItem(SERVICE_A)], null))));
  router.on(overridesPath, () => history.promise);
  renderScreen();
  await chooseEmployee(EMP_A_ID);
  fireEvent.click(await screen.findByRole('button', { name: L.edit }));
  await screen.findByText(t('en', 'commissionOverrides.historyTitle'));
  history.resolve(refusal(403, 'FORBIDDEN'));
  expect(await screen.findByText(L.denied)).toBeTruthy();
  expect(screen.queryByRole('button', { name: L.edit })).toBeNull();
  const reads = api.GET.mock.calls.length;
  await act(async () => {
    history.resolve(ok(overridePage([overrideItem(SERVICE_A)], null)));
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(api.GET.mock.calls.length).toBe(reads);
});

it('late answers after an employee switch change nothing: a services page and a pending save', async () => {
  const router = makeRouter();
  const servicesA = deferredAnswer();
  router.on(employeesPath, () =>
    Promise.resolve(
      ok(
        employeePage(
          [employeeItem(EMP_A_ID, 7, null, 'Sara'), employeeItem(EMP_B_ID, 9, null, 'Nada')],
          null,
        ),
      ),
    ),
  );
  router.on(overrideServicesPath, (options) => {
    const employeeId = options?.params?.path?.employeeId;
    return employeeId === EMP_B_ID
      ? Promise.resolve(ok(servicePage([serviceItem(SERVICE_B)], null)))
      : servicesA.promise;
  });
  router.on(overridesPath, () => Promise.resolve(ok(overridePage([], null))));
  renderScreen();
  await chooseEmployee(EMP_A_ID);
  await chooseEmployee(EMP_B_ID);
  expect(await screen.findByText('Service 4')).toBeTruthy();
  await act(async () => {
    servicesA.resolve(ok(servicePage([serviceItem(SERVICE_A)], null)));
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByText('Service 3')).toBeNull();
  expect(screen.getByText('Service 4')).toBeTruthy();
});

it('the held key of service A survives a save on B, a dialog close and an employee switch, and A\'s refusal is not shown on B', async () => {
  const router = makeRouter();
  router.on(employeesPath, () =>
    Promise.resolve(
      ok(
        employeePage(
          [employeeItem(EMP_A_ID, 7, null, 'Sara'), employeeItem(EMP_B_ID, 9, null, 'Nada')],
          null,
        ),
      ),
    ),
  );
  router.on(overrideServicesPath, () =>
    Promise.resolve(ok(servicePage([serviceItem(SERVICE_A), serviceItem(SERVICE_B)], null))),
  );
  router.on(overridesPath, () => Promise.resolve(ok(overridePage([], null))));
  api.POST.mockRejectedValue(new Error('network died'));
  renderScreen();
  await chooseEmployee(EMP_A_ID);
  fireEvent.click((await screen.findAllByRole('button', { name: L.edit }))[0] as HTMLElement);
  fireEvent.change(await screen.findByLabelText(L.bps), { target: { value: '1500' } });
  let save = screen.getByRole('button', { name: L.save });
  await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(save);
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
  const keyA = api.POST.mock.calls[0]?.[1].params.header['Idempotency-Key'];
  expect(await screen.findByText(t('en', 'admin.unexpected'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'commissionOverrides.cancel') }));
  await waitFor(() => expect(screen.queryByLabelText(L.bps)).toBeNull());
  fireEvent.click((await screen.findAllByRole('button', { name: L.edit }))[1] as HTMLElement);
  const bpsB = await screen.findByLabelText(L.bps);
  fireEvent.change(bpsB, { target: { value: '1500' } });
  expect(screen.queryByText(t('en', 'admin.unexpected'))).toBeNull();
  save = screen.getByRole('button', { name: L.save });
  await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(save);
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
  const keyB = api.POST.mock.calls[1]?.[1].params.header['Idempotency-Key'];
  expect(keyB).not.toBe(keyA);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'commissionOverrides.cancel') }));
  await waitFor(() => expect(screen.queryByLabelText(L.bps)).toBeNull());
  await chooseEmployee(EMP_B_ID);
  await chooseEmployee(EMP_A_ID);
  fireEvent.click((await screen.findAllByRole('button', { name: L.edit }))[0] as HTMLElement);
  fireEvent.change(await screen.findByLabelText(L.bps), { target: { value: '1500' } });
  save = screen.getByRole('button', { name: L.save });
  await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(save);
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(3));
  expect(api.POST.mock.calls[2]?.[1].params.header['Idempotency-Key']).toBe(keyA);
});

it('a future-dated save leaves the table row unchanged and adds a history row without the current mark', async () => {
  const router = makeRouter();
  router.on(employeesPath, () =>
    Promise.resolve(ok(employeePage([employeeItem(EMP_A_ID, 7, null, 'Sara')], null))),
  );
  router.on(overrideServicesPath, () => Promise.resolve(ok(servicePage([serviceItem(SERVICE_A)], null))));
  router.on(overridesPath, () =>
    Promise.resolve(ok(overridePage([overrideItem(SERVICE_A, { is_current: false })], null))),
  );
  api.POST.mockResolvedValue(ok(overrideItem(SERVICE_A, { effective_from: '2026-12-01' })));
  renderScreen();
  await chooseEmployee(EMP_A_ID);
  fireEvent.click(await screen.findByRole('button', { name: L.edit }));
  const date = await screen.findByLabelText(t('en', 'commissionOverrides.effectiveFrom'));
  fireEvent.change(date, { target: { value: '2026-12-01' } });
  fireEvent.change(screen.getByLabelText(L.bps), { target: { value: '1500' } });
  const save = screen.getByRole('button', { name: L.save });
  await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(save);
  expect(await screen.findByText(L.saved)).toBeTruthy();
  expect(api.POST.mock.calls[0]?.[1].body).toEqual({
    service_id: SERVICE_A,
    rule: { kind: 'PCT', value: 1500 },
    effective_from: '2026-12-01',
  });
  expect(screen.queryByText(L.current)).toBeNull();
});

it('table pages, a failed page, the empty business and a local employee 404', async () => {
  const router = makeRouter();
  router.on(employeesPath, () =>
    Promise.resolve(ok(employeePage([employeeItem(EMP_A_ID, 7, null, 'Sara')], null))),
  );
  router.on(overrideServicesPath, (options) => {
    const cursor = options?.params?.query?.cursor;
    if (cursor !== undefined) return Promise.resolve(refusal(500, 'INTERNAL'));
    return Promise.resolve(ok(servicePage([serviceItem(SERVICE_A)], CURSOR)));
  });
  router.on(overridesPath, () => Promise.resolve(ok(overridePage([], null))));
  renderScreen();
  await chooseEmployee(EMP_A_ID);
  fireEvent.click(await screen.findByRole('button', { name: L.loadMore }));
  expect(await screen.findByText(L.couldNot)).toBeTruthy();
  expect(screen.getByRole('button', { name: L.loadMore })).toBeTruthy();
  router.on(overrideServicesPath, () => Promise.resolve(ok(servicePage([], null))));
  await act(async () => {
    await client.invalidateQueries({ queryKey: planOverrideServicesKey(scope, EMP_A_ID) });
  });
  expect(await screen.findByText(L.empty)).toBeTruthy();
  router.on(overrideServicesPath, () => Promise.resolve(refusal(404, 'EMPLOYEE_NOT_FOUND')));
  await act(async () => {
    await client.invalidateQueries({ queryKey: planOverrideServicesKey(scope, EMP_A_ID) });
  });
  expect(await screen.findByText(L.employeeMissing)).toBeTruthy();
  expect(screen.queryByText(L.denied)).toBeNull();
  expect(screen.getByLabelText(t('en', 'commissionPlanBuilder.pickerLabel'))).toBeTruthy();
});
