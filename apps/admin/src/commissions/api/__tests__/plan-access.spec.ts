import { waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createQueryClient } from '@/shared/api/query-client';
import {
  denyPlanAccess,
  planBlockedCorrectionsKey,
  planEmployeesKey,
  planGeneration,
  planProbeKey,
  planScope,
  planVersionsKey,
  restorePlanAccess,
} from '../plan-access';
import { deferredAnswer, employeePage, ok } from './plan-http';

const scope = planScope('company', 'business', 'user');

function accessEntry(client: ReturnType<typeof createQueryClient>) {
  return client.getQueryData<{ denied: boolean; generation: number }>([...scope, 'access']);
}

async function inFlightEmployeesFetch(client: ReturnType<typeof createQueryClient>) {
  const deferred = deferredAnswer();
  const fetcher = vi.fn(() => deferred.promise);
  const pending = client.fetchQuery({
    queryKey: planEmployeesKey(scope),
    queryFn: fetcher as never,
  });
  pending.catch(() => undefined);
  return { deferred, fetcher, pending };
}

it('denyPlanAccess closes the whole scope: denied flag, in-flight answer discarded, data removal, no refetch', async () => {
  const client = createQueryClient();
  client.setQueryData(planVersionsKey(scope, 'emp'), { items: [], next_cursor: null });
  const { deferred, fetcher, pending } = await inFlightEmployeesFetch(client);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await denyPlanAccess(client, scope);
  const entry = accessEntry(client);
  expect(entry?.denied).toBe(true);
  expect(entry?.generation).toBe(1);
  expect(client.getQueryData(planEmployeesKey(scope))).toBeUndefined();
  expect(client.getQueryData(planVersionsKey(scope, 'emp'))).toBeUndefined();
  deferred.resolve(ok(employeePage([{ id: 'emp' }], null)));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(client.getQueryData(planEmployeesKey(scope))).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(fetcher).toHaveBeenCalledTimes(1);
  void pending;
  expect(accessEntry(client)?.denied).toBe(true);
});

it('planBlockedCorrectionsKey lives under the scope, takes the filter, and denyPlanAccess clears every filter', async () => {
  expect(planBlockedCorrectionsKey(scope)).toEqual([...scope, 'blocked-corrections']);
  expect(planBlockedCorrectionsKey(scope, 'resolved')).toEqual([
    ...scope,
    'blocked-corrections',
    'resolved',
  ]);
  const client = createQueryClient();
  client.setQueryData(planBlockedCorrectionsKey(scope, 'open'), { pages: [], pageParams: [] });
  client.setQueryData(planBlockedCorrectionsKey(scope, 'all'), { pages: [], pageParams: [] });
  await denyPlanAccess(client, scope);
  expect(client.getQueryData(planBlockedCorrectionsKey(scope, 'open'))).toBeUndefined();
  expect(client.getQueryData(planBlockedCorrectionsKey(scope, 'all'))).toBeUndefined();
});

it('restorePlanAccess opens a new generation with the flag off and keeps data empty', async () => {
  const client = createQueryClient();
  await denyPlanAccess(client, scope);
  restorePlanAccess(client, scope);
  const entry = accessEntry(client);
  expect(entry?.denied).toBe(false);
  expect(entry?.generation).toBe(2);
  expect(client.getQueryData(planEmployeesKey(scope))).toBeUndefined();
  expect(planGeneration(client, scope)).toBe(2);
});

it('denyPlanAccess keeps the access entry itself so the nav item and the page see the same value', async () => {
  const client = createQueryClient();
  client.setQueryData(planVersionsKey(scope, 'emp'), { items: [], next_cursor: null });
  await denyPlanAccess(client, scope);
  await waitFor(() => expect(accessEntry(client)?.denied).toBe(true));
  expect(accessEntry(client)).toEqual({ denied: true, generation: 1 });
});

it('denyPlanAccess removes the nav probe with the employee list it lives under', async () => {
  const client = createQueryClient();
  client.setQueryData(planProbeKey(scope), { pages: [], pageParams: [] });
  await denyPlanAccess(client, scope);
  expect(client.getQueryData(planProbeKey(scope))).toBeUndefined();
});

it('a deny landing while the access query initial fetch is in flight keeps the denied state and starts no loop', async () => {
  const client = createQueryClient();
  client.setQueryData(planEmployeesKey(scope), employeePage([{ id: 'emp' }], null));
  client.setQueryData(planVersionsKey(scope, 'emp'), { items: [], next_cursor: null });
  // مشترك بيبدأ جلب الوصول الأولي وموجِّه بيأخّره: نافذة إنكار وصلت والجلب لسه شغّال.
  const accessRead = deferredAnswer();
  const accessPending = client.fetchQuery({
    queryKey: [...scope, 'access'],
    queryFn: () => accessRead.promise as never,
  });
  accessPending.catch(() => undefined);
  await denyPlanAccess(client, scope);
  expect(accessEntry(client)).toEqual({ denied: true, generation: 1 });
  expect(client.getQueryData(planEmployeesKey(scope))).toBeUndefined();
  expect(client.getQueryData(planVersionsKey(scope, 'emp'))).toBeUndefined();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(accessEntry(client)?.denied).toBe(true);
});
