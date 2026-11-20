import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { createQueryClient } from '@/shared/api/query-client';
import { planScope } from '../../api/plan-access';
import {
  deferredAnswer,
  EMP_A as EMP_A_ID,
  EMP_B as EMP_B_ID,
  employeeItem,
  ok,
  refusal,
  routeGet,
  versionItem,
  versionPage,
} from '../../api/__tests__/plan-http';
import type { PlanAttemptMemory } from '../../api/use-save-commission-plan';
import { CommissionPlanSection } from '../commission-plan-section';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

const scope = planScope('company', 'business', 'user-a');
const EMP_A = employeeItem(EMP_A_ID, 7, 'سارة', 'Sara');
const EMP_B = employeeItem(EMP_B_ID, 9, null, 'Nada');
const B = {
  base: t('en', 'commissionPlanBuilder.blockBase'),
  effectiveFrom: t('en', 'commissionPlanBuilder.effectiveFrom'),
  bpsLabel: t('en', 'commissionPlanBuilder.bpsLabel'),
  save: t('en', 'commissionPlanBuilder.save'),
  loadMore: t('en', 'commissionPlanBuilder.loadMore'),
};

let client: QueryClient;
let memory: PlanAttemptMemory;

function mountSection(employee: typeof EMP_A) {
  return render(
    <QueryClientProvider client={client}>
      <CommissionPlanSection
        key={employee.id}
        scope={scope}
        employee={employee}
        employeeLabel={employee.id === EMP_A.id ? 'Sara — #7' : 'Nada — #9'}
        timeZone="Asia/Kuwait"
        memory={memory}
      />
    </QueryClientProvider>,
  );
}

function baseBlock(): HTMLElement {
  return screen.getByRole('group', { name: B.base });
}

function bpsInput(): HTMLInputElement {
  return within(baseBlock()).getByLabelText(B.bpsLabel) as HTMLInputElement;
}

async function fillValidBase(): Promise<HTMLButtonElement> {
  const save = (await screen.findByRole('button', { name: B.save })) as HTMLButtonElement;
  fireEvent.click(within(baseBlock()).getByRole('switch'));
  fireEvent.change(bpsInput(), { target: { value: '500' } });
  await waitFor(() => expect(save.disabled).toBe(false));
  return save;
}

function dateInput(): HTMLInputElement {
  return screen.getByLabelText(B.effectiveFrom) as HTMLInputElement;
}

beforeEach(() => {
  api.GET.mockReset();
  api.POST.mockReset();
  client = createQueryClient();
  memory = { current: new Map() };
});

afterEach(() => {
  vi.useRealTimers();
});

it('mounts the editor only after the first history page succeeds, based on the stored version', async () => {
  const pending = deferredAnswer();
  routeGet(api.GET, async () => pending.promise);
  const view = mountSection(EMP_A);
  expect(screen.queryByRole('button', { name: B.save })).toBeNull();
  pending.resolve(
    ok(
      versionPage(
        [
          versionItem(EMP_A_ID, 2, {
            effective_from: '2026-02-02',
            base: { enabled: true, calc: { kind: 'PCT', bps: 500 } },
          }),
        ],
        null,
      ),
    ),
  );
  await screen.findByRole('button', { name: B.save });
  expect(dateInput().value).toBe('2026-02-02');
  expect(bpsInput().value).toBe('500');
  view.unmount();
});

it('starts an empty history on the business day in the business time zone, not the browser day', async () => {
  vi.setSystemTime(new Date('2026-11-20T21:00:00Z'));
  const pending = deferredAnswer();
  routeGet(api.GET, async () => pending.promise);
  const view = render(
    <QueryClientProvider client={client}>
      <CommissionPlanSection
        scope={scope}
        employee={EMP_A}
        employeeLabel="Sara — #7"
        timeZone="Pacific/Kiritimati"
        memory={memory}
      />
    </QueryClientProvider>,
  );
  pending.resolve(ok(versionPage([], null)));
  await screen.findByRole('button', { name: B.save });
  expect(dateInput().value).toBe('2026-11-21');
  view.unmount();
});

it('keeps the typed value through a history 500, a failed load more and a refetch', async () => {
  const first = deferredAnswer();
  routeGet(api.GET, async () => first.promise);
  mountSection(EMP_A);
  first.resolve(ok(versionPage([], 12)));
  await fillValidBase();
  const refetch = deferredAnswer();
  routeGet(api.GET, async () => refetch.promise);
  void client.refetchQueries({ queryKey: [...scope, 'versions', EMP_A_ID] });
  refetch.reject({
    code: 'INTERNAL',
    message_ar: 'عربي',
    message_en: 'Synthetic refusal',
    status: 500,
  });
  expect((await screen.findByRole('alert')).textContent).toBe('Synthetic refusal');
  expect(bpsInput().value).toBe('500');
  routeGet(api.GET, async () => Promise.reject(new Error('network died')));
  fireEvent.click(screen.getByRole('button', { name: B.loadMore }));
  expect(await screen.findByText(t('en', 'commissionPlanBuilder.couldNotLoadMore'))).toBeTruthy();
  expect(bpsInput().value).toBe('500');
});

it('shows the local not-found message and stops asking for a deleted employee', async () => {
  const first = deferredAnswer();
  routeGet(api.GET, async () => first.promise);
  memory.current.set(EMP_A_ID, { key: 'held-key', fingerprint: 'f' });
  mountSection(EMP_A);
  first.resolve(refusal(404, 'EMPLOYEE_NOT_FOUND'));
  expect(await screen.findByText(t('en', 'errors.EMPLOYEE_NOT_FOUND'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: B.save })).toBeNull();
  expect(memory.current.has(EMP_A_ID)).toBe(false);
  const reads = api.GET.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(api.GET.mock.calls.length).toBe(reads);
});

it('a save pending for employee A does not alter employee B when the admin switches', async () => {
  const pendingA = deferredAnswer();
  const pendingB = deferredAnswer();
  routeGet(api.GET, async (_path, options) =>
    options?.params?.path?.employeeId === EMP_B_ID ? pendingB.promise : pendingA.promise,
  );
  const view = mountSection(EMP_A);
  pendingA.resolve(
    ok(
      versionPage(
        [versionItem(EMP_A_ID, 2, { base: { enabled: true, calc: { kind: 'PCT', bps: 500 } } })],
        null,
      ),
    ),
  );
  await screen.findByRole('button', { name: B.save });
  const savingPost = deferredAnswer();
  api.POST.mockImplementationOnce(() => savingPost.promise);
  fireEvent.click(screen.getByRole('button', { name: B.save }));
  view.rerender(
    <QueryClientProvider client={client}>
      <CommissionPlanSection
        key={EMP_B.id}
        scope={scope}
        employee={EMP_B}
        employeeLabel="Nada — #9"
        timeZone="Asia/Kuwait"
        memory={memory}
      />
    </QueryClientProvider>,
  );
  expect(screen.queryByRole('button', { name: B.save })).toBeNull();
  savingPost.resolve(ok(versionItem(EMP_A_ID, 3)));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByRole('button', { name: B.save })).toBeNull();
  pendingB.resolve(ok(versionPage([], null)));
  await screen.findByRole('button', { name: B.save });
  expect((within(baseBlock()).getByRole('switch') as HTMLInputElement).checked).toBe(false);
  expect(bpsInput().value).toBe('');
});

it('a successful save tops the history with the stored version and re-bases the form on it', async () => {
  const pending = deferredAnswer();
  routeGet(api.GET, async () => pending.promise);
  mountSection(EMP_A);
  pending.resolve(ok(versionPage([], null)));
  const save = await fillValidBase();
  api.POST.mockResolvedValueOnce(
    ok(
      versionItem(EMP_A_ID, 1, {
        effective_from: '2027-01-05',
        base: { enabled: true, calc: { kind: 'PCT', bps: 250 } },
      }),
    ),
  );
  fireEvent.click(save);
  await waitFor(() => {
    const firstDataRow = screen.getAllByRole('row').slice(1)[0] as HTMLElement | undefined;
    expect(firstDataRow && within(firstDataRow).getAllByRole('cell')[0]?.textContent).toBe('1');
  });
  expect(dateInput().value).toBe('2027-01-05');
  expect(bpsInput().value).toBe('250');
  expect(api.POST.mock.calls[0]?.[1].params.header['Idempotency-Key']).toBeTruthy();
});
