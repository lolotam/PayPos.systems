import { t } from '@pospay/i18n';
import { QueryClient } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/shared/api/query-client';

import {
  businessId,
  companyId,
  hold,
  permissionResponses,
  releaseHeldReads,
  renderBrowser,
  userId,
} from './permission-membership-refresh.fixture';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en', get: vi.fn() }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get }) }));

const clients: QueryClient[] = [];
const LIST_PATH = '/v1/permissions/memberships';
const DRAFT = 'Draft retained across refresh';
const LOCALES = ['ar', 'en'] as const;
const listKey = ['permissions', companyId, userId, null, 'memberships', undefined];

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  releaseHeldReads();
  for (const client of clients) client.clear();
  clients.length = 0;
  state.get.mockReset();
});

it('settles owned read holds and drains outstanding reads safely', async () => {
  const pending = hold();
  let settled = false;
  void pending.promise.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  pending.release();
  await pending.promise;
  expect(settled).toBe(true);
  const first = hold();
  const second = hold();
  expect(releaseHeldReads()).toBe(2);
  await Promise.all([first.promise, second.promise]);
  expect(releaseHeldReads()).toBe(0);
  expect(releaseHeldReads()).toBe(0);
});

it.each([
  ['ar', false],
  ['en', false],
  ['ar', true],
  ['en', true],
] as const)(
  'hides cached memberships and selected editor after refused list refresh (%s, business=%s)',
  async (locale, businessScoped) => {
    state.locale = locale;
    const business = businessScoped ? businessId : undefined;
    const listPath = businessScoped
      ? '/v1/businesses/{businessId}/permissions/memberships'
      : '/v1/permissions/memberships';
    const detailPath = `${listPath}/{membershipId}`;
    const { page, detail } = permissionResponses(businessScoped, business);
    let refused = false;
    state.get.mockImplementation(async (path: string) => {
      if (path === listPath) {
        return refused
          ? {
              error: {
                code: 'FORBIDDEN',
                message_ar: t('ar', 'errors.FORBIDDEN'),
                message_en: t('en', 'errors.FORBIDDEN'),
              },
            }
          : { data: page };
      }
      if (path === detailPath) return { data: detail };
      throw new Error(`Unexpected test request: ${path}`);
    });
    const client = createQueryClient();
    clients.push(client);
    renderBrowser(client, business);
    fireEvent.click(await screen.findByRole('button', { name: t(locale, 'permissions.view') }));
    expect(await screen.findByRole('button', { name: t(locale, 'permissions.save') })).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
    const scopedListKey = [
      'permissions',
      companyId,
      userId,
      business ?? null,
      'memberships',
      undefined,
    ];
    refused = true;
    await act(async () => {
      await client.refetchQueries({ queryKey: scopedListKey, exact: true });
    });
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(t(locale, 'errors.FORBIDDEN'));
      expect(screen.queryByRole('table')).toBeNull();
      expect(screen.queryByRole('button', { name: t(locale, 'permissions.view') })).toBeNull();
      expect(screen.queryByRole('button', { name: t(locale, 'permissions.next') })).toBeNull();
      expect(screen.queryByRole('button', { name: t(locale, 'permissions.save') })).toBeNull();
    });
    expect(client.getQueryData(scopedListKey)).toEqual(page);
    refused = false;
    await act(async () => {
      await client.refetchQueries({ queryKey: scopedListKey, exact: true });
    });
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(await screen.findByRole('button', { name: t(locale, 'permissions.save') })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  },
);

type Locale = (typeof LOCALES)[number];
type Step = { gate?: Promise<void>; fail?: boolean; data?: unknown };

function defaultClient() {
  const client = createQueryClient();
  expect(client.getDefaultOptions().queries?.retry).toBe(false);
  return client;
}

async function openEditor(locale: Locale, client: QueryClient = defaultClient()) {
  state.locale = locale;
  const { page, detail } = permissionResponses(false, undefined);
  clients.push(client);
  const steps: Step[] = [];
  const calls = { list: 0 };
  state.get.mockImplementation(async (path: string) => {
    if (path === `${LIST_PATH}/{membershipId}`) return { data: detail };
    if (path !== LIST_PATH) throw new Error(`Unexpected test request: ${path}`);
    calls.list += 1;
    const step = steps.shift() ?? {};
    await step.gate;
    if (step.fail) throw new Error('Synthetic transient network failure');
    return { data: step.data ?? page };
  });
  renderBrowser(client, undefined);
  fireEvent.click(await screen.findByRole('button', { name: t(locale, 'permissions.view') }));
  const reason = await screen.findByLabelText<HTMLInputElement>(t(locale, 'permissions.reason'), {
    selector: '#override-reason',
  });
  return { client, page, steps, calls, reason };
}

const saveButton = (locale: Locale) =>
  screen.queryByRole('button', { name: t(locale, 'permissions.save') });

function startRefresh(client: QueryClient) {
  let refreshed: Promise<void> = Promise.resolve();
  act(() => {
    refreshed = client.refetchQueries({ queryKey: listKey, exact: true });
  });
  return refreshed;
}

async function settle(release: () => void, refreshed: Promise<void>) {
  await act(async () => {
    release();
    await refreshed;
  });
}

function expectEditorVisible(locale: Locale, reason: HTMLInputElement) {
  expect(screen.getByRole('table')).toBeTruthy();
  expect(saveButton(locale)?.matches(':disabled')).toBe(false);
  expect(reason.isConnected).toBe(true);
  expect(reason.matches(':disabled')).toBe(false);
  expect(document.activeElement).toBe(reason);
  expect(screen.queryByRole('alert')).toBeNull();
}

function expectFailClosed(locale: Locale) {
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
  expect(saveButton(locale)).toBeNull();
}

it.each(LOCALES)(
  'keeps the table, editor, focus and draft during a held background refresh (%s)',
  async (locale) => {
    const { client, steps, reason } = await openEditor(locale);
    fireEvent.change(reason, { target: { value: DRAFT } });
    reason.focus();
    const held = hold();
    steps.push({ gate: held.promise });
    const refreshed = startRefresh(client);
    await waitFor(() => expect(client.isFetching({ queryKey: listKey })).toBe(1));
    expectEditorVisible(locale, reason);
    fireEvent.change(reason, { target: { value: `${DRAFT} — still typing` } });
    expect(document.activeElement).toBe(reason);
    await settle(held.release, refreshed);
    expectEditorVisible(locale, reason);
    expect(reason.value).toBe(`${DRAFT} — still typing`);
  },
);

it.each(LOCALES)(
  'keeps focus and draft across the automatic 30 second poll (%s)',
  async (locale) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { client, steps, calls, reason } = await openEditor(locale);
    fireEvent.change(reason, { target: { value: DRAFT } });
    reason.focus();
    const held = hold();
    steps.push({ gate: held.promise });
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    await waitFor(() => expect(calls.list).toBe(2));
    expectEditorVisible(locale, reason);
    expect(reason.value).toBe(DRAFT);
    await act(async () => {
      held.release();
    });
    await waitFor(() => expect(client.isFetching({ queryKey: listKey })).toBe(0));
    expectEditorVisible(locale, reason);
    expect(reason.value).toBe(DRAFT);
  },
);

it.each(LOCALES)(
  'fails closed on a refused refresh and stays closed while recovery is pending (%s)',
  async (locale) => {
    const { client, steps, reason } = await openEditor(locale);
    fireEvent.change(reason, { target: { value: DRAFT } });
    const failing = hold();
    steps.push({ gate: failing.promise, fail: true });
    await settle(failing.release, startRefresh(client));
    await waitFor(() => expectFailClosed(locale));
    const recovery = hold();
    steps.push({ gate: recovery.promise });
    const recovering = startRefresh(client);
    await waitFor(() => expect(client.isFetching({ queryKey: listKey })).toBe(1));
    expectFailClosed(locale);
    await settle(recovery.release, recovering);
    expect(await screen.findByRole('table')).toBeTruthy();
    await expectRetainedDraft(locale);
    expect(screen.queryByRole('alert')).toBeNull();
  },
);

it.each(LOCALES)(
  'fails closed during an intermediate retry failure and restores the draft after recovery (%s)',
  async (locale) => {
    const retrying = new QueryClient({
      defaultOptions: { queries: { retry: 1, retryDelay: 0, staleTime: 30_000 } },
    });
    const { client, steps, reason } = await openEditor(locale, retrying);
    fireEvent.change(reason, { target: { value: DRAFT } });
    const failing = hold();
    const recovery = hold();
    steps.push({ gate: failing.promise, fail: true }, { gate: recovery.promise });
    const refreshed = startRefresh(client);
    act(() => failing.release());
    await waitFor(() => expectFailClosed(locale));
    expect(client.getQueryState(listKey)?.fetchFailureCount).toBeGreaterThan(0);
    await settle(recovery.release, refreshed);
    expect(await screen.findByRole('table')).toBeTruthy();
    await expectRetainedDraft(locale);
    expect(screen.queryByRole('alert')).toBeNull();
  },
);

it.each(LOCALES)(
  'removes an absent selection and does not resurrect it when it reappears (%s)',
  async (locale) => {
    const { client, steps, page } = await openEditor(locale);
    const nextPage = { ...page, items: [] };
    steps.push({ data: nextPage });
    await act(() => client.refetchQueries({ queryKey: listKey, exact: true }));
    await waitFor(() => {
      expect(saveButton(locale)).toBeNull();
      expect(
        screen.queryAllByRole('textbox', { name: t(locale, 'permissions.reason') }),
      ).toHaveLength(0);
    });
    expect(client.getQueryData(listKey)).toEqual(nextPage);
    steps.push({ data: { ...page, items: page.items } });
    await act(() => client.refetchQueries({ queryKey: listKey, exact: true }));
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(saveButton(locale)).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: t(locale, 'permissions.view') }));
    const fresh = await screen.findByLabelText<HTMLInputElement>(t(locale, 'permissions.reason'), {
      selector: '#override-reason',
    });
    expect(fresh.value).toBe('');
  },
);

async function expectRetainedDraft(locale: Locale) {
  expect(await screen.findByRole('button', { name: t(locale, 'permissions.save') })).toBeTruthy();
  expect(
    screen.getByLabelText<HTMLInputElement>(t(locale, 'permissions.reason'), {
      selector: '#override-reason',
    }).value,
  ).toBe(DRAFT);
}