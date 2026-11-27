import { act, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { createQueryClient } from '@/shared/api/query-client';
import { denyPlanAccess, planScope, planSeedKey, planVersionsKey } from '../../api/plan-access';
import {
  deferredAnswer,
  EMP_A as EMP_A_ID,
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
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));

const scope = planScope('company', 'business', 'user-a');
const EMP_A = employeeItem(EMP_A_ID, 7, 'سارة', 'Sara');
const B = {
  base: t('en', 'commissionPlanBuilder.blockBase'),
  bpsLabel: t('en', 'commissionPlanBuilder.bpsLabel'),
  save: t('en', 'commissionPlanBuilder.save'),
  repairOf: t('en', 'commissionPlanBuilder.repairOf'),
};

const repair = (version: number) =>
  versionItem(EMP_A_ID, version, {
    effective_from: '2026-09-01',
    repair_period: '2026-09',
    base: { enabled: true, calc: { kind: 'PCT', bps: 900 } },
  });
const ordinary = versionItem(EMP_A_ID, 1, {
  effective_from: '2026-01-01',
  base: { enabled: true, calc: { kind: 'PCT', bps: 500 } },
});

let client: QueryClient;
beforeEach(() => {
  api.GET.mockReset();
  client = createQueryClient();
});
afterEach(() => {
  client.clear();
});

/** يرد على قراءة الأساس (kind=ordinary) وقراءة التاريخ العادية بإجابتين مختلفتين. */
function route(seed: unknown, history: unknown) {
  routeGet(api.GET, async (_path, options) =>
    options?.params?.query?.['kind'] === 'ordinary' ? (seed as never) : (history as never),
  );
}

function mount() {
  const memory: PlanAttemptMemory = { current: new Map() };
  return render(
    <QueryClientProvider client={client}>
      <CommissionPlanSection
        scope={scope}
        employee={EMP_A}
        employeeLabel="Sara — #7"
        timeZone="Asia/Kuwait"
        memory={memory}
      />
    </QueryClientProvider>,
  );
}

const bps = () =>
  (
    within(screen.getByRole('group', { name: B.base })).getByLabelText(
      B.bpsLabel,
    ) as HTMLInputElement
  ).value;

it('a first history page that is all repairs still seeds the editor from the older ordinary version, and the repairs are labelled', async () => {
  route(ok(versionPage([ordinary], null)), ok(versionPage([repair(3), repair(2)], 1)));
  mount();

  await screen.findByRole('button', { name: B.save });

  expect(bps()).toBe('500');
  const labelled = await screen.findAllByText(new RegExp(`${B.repairOf} 2026-09`));
  expect(labelled).toHaveLength(2);
  const seedCall = api.GET.mock.calls.find((call) => call[1].params.query.kind === 'ordinary');
  expect(seedCall?.[1].params.query).toEqual({ limit: 1, kind: 'ordinary' });
});

it('with no ordinary version at all the editor opens empty, only after the read confirmed it', async () => {
  route(ok(versionPage([], null)), ok(versionPage([repair(2)], null)));
  mount();

  await screen.findByRole('button', { name: B.save });

  expect(bps()).toBe('');
});

it('a failed seed read shows the refusal and never opens the editor on an empty draft', async () => {
  route(refusal(500, 'INTERNAL'), ok(versionPage([ordinary], null)));
  mount();

  expect((await screen.findByRole('alert')).textContent).toBe('Synthetic refusal');
  await screen.findByRole('table');
  expect(screen.queryByRole('button', { name: B.save })).toBeNull();
});

it('an ordinary version of the history that is not a repair carries no repair label', async () => {
  route(ok(versionPage([ordinary], null)), ok(versionPage([ordinary], null)));
  mount();

  await screen.findByRole('button', { name: B.save });

  expect(screen.queryByText(new RegExp(B.repairOf))).toBeNull();
});

it('keeps the editor hidden until both the seed read and the first history page have settled', async () => {
  const history = deferredAnswer();
  routeGet(api.GET, async (_path, options) =>
    options?.params?.query?.['kind'] === 'ordinary'
      ? ok(versionPage([ordinary], null))
      : history.promise,
  );
  mount();

  // الدليل إن القراءتين بدأوا وإن البذرة نجحت في الكاش فعلاً والتاريخ لسه معلّق: بعدها بس نتأكد إن الحفظ مش ظاهر.
  await waitFor(() => expect(client.getQueryData(planSeedKey(scope, EMP_A_ID))).toBeTruthy());
  expect(client.isFetching({ queryKey: [...scope, 'versions', EMP_A_ID] })).toBe(1);
  expect(screen.queryByRole('button', { name: B.save })).toBeNull();
  history.resolve(ok(versionPage([ordinary], null)));

  await screen.findByRole('button', { name: B.save });
});

it('a 403 removes the cached seed with the other plan caches, so the editor disappears and nothing stays cached', async () => {
  route(ok(versionPage([ordinary], null)), ok(versionPage([ordinary], null)));
  mount();
  await screen.findByRole('button', { name: B.save });

  await act(async () => {
    await denyPlanAccess(client, scope);
  });

  await waitFor(() => expect(screen.queryByRole('button', { name: B.save })).toBeNull());
  expect(client.getQueryData(planSeedKey(scope, EMP_A_ID))).toBeUndefined();
});

it('never opens on a seed older than the newest ordinary version of the first history page: the page itself is the base, with no second seed read', async () => {
  const newer = versionItem(EMP_A_ID, 2, {
    base: { enabled: true, calc: { kind: 'PCT', bps: 800 } },
  });
  let seedReads = 0;
  routeGet(api.GET, async (_path, options) =>
    options?.params?.query?.['kind'] === 'ordinary'
      ? ok(versionPage([++seedReads === 1 ? ordinary : newer], null))
      : ok(versionPage([newer, ordinary], null)),
  );
  mount();

  await screen.findByRole('button', { name: B.save });

  expect(bps()).toBe('800');
  expect(seedReads).toBe(1);
});

it('a failed seed keeps the editor closed, and a refetch that recovers opens it with the draft', async () => {
  let seedReads = 0;
  routeGet(api.GET, async (_path, options) =>
    options?.params?.query?.['kind'] === 'ordinary'
      ? ++seedReads === 1
        ? refusal(500, 'INTERNAL')
        : ok(versionPage([ordinary], null))
      : ok(versionPage([ordinary], null)),
  );
  mount();

  expect((await screen.findByRole('alert')).textContent).toBe('Synthetic refusal');
  expect(screen.queryByRole('button', { name: B.save })).toBeNull();

  await act(async () => {
    await client.refetchQueries({ queryKey: planSeedKey(scope, EMP_A_ID) });
  });

  await screen.findByRole('button', { name: B.save });
  expect(bps()).toBe('500');
});

it('a history that advanced past the seed opens the editor with the newer ordinary version', async () => {
  const newer = versionItem(EMP_A_ID, 2, {
    base: { enabled: true, calc: { kind: 'PCT', bps: 800 } },
  });
  const seed = deferredAnswer();
  routeGet(api.GET, async (_path, options) =>
    options?.params?.query?.['kind'] === 'ordinary' ? seed.promise : ok(versionPage([newer], null)),
  );
  mount();

  // الدليل إن التاريخ وصل لنسخة أحدث والبذرة لسه معلقة: المحرّر يفضل مقفول.
  await waitFor(() => expect(client.getQueryData(planVersionsKey(scope, EMP_A_ID))).toBeTruthy());
  expect(screen.queryByRole('button', { name: B.save })).toBeNull();

  seed.resolve(ok(versionPage([ordinary], null)));

  await screen.findByRole('button', { name: B.save });
  expect(bps()).toBe('800');
});

it('a seed that succeeded but a failed first history page keeps the editor closed and shows the error', async () => {
  const history = deferredAnswer();
  routeGet(api.GET, async (_path, options) =>
    options?.params?.query?.['kind'] === 'ordinary'
      ? ok(versionPage([ordinary], null))
      : history.promise,
  );
  mount();

  await waitFor(() => expect(client.getQueryData(planSeedKey(scope, EMP_A_ID))).toBeTruthy());
  history.resolve(refusal(500, 'INTERNAL'));

  expect((await screen.findByRole('alert')).textContent).toBe('Synthetic refusal');

  expect(screen.queryByRole('button', { name: B.save })).toBeNull();
});
