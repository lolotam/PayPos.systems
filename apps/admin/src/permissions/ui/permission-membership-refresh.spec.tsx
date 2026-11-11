import { t } from '@pospay/i18n';
import type { QueryClient } from '@tanstack/react-query';
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

afterEach(() => {
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
    const listKey = ['permissions', companyId, userId, business ?? null, 'memberships', undefined];
    refused = true;
    await act(async () => {
      await client.refetchQueries({ queryKey: listKey, exact: true });
    });
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(t(locale, 'errors.FORBIDDEN'));
      expect(screen.queryByRole('table')).toBeNull();
      expect(screen.queryByRole('button', { name: t(locale, 'permissions.view') })).toBeNull();
      expect(screen.queryByRole('button', { name: t(locale, 'permissions.next') })).toBeNull();
      expect(screen.queryByRole('button', { name: t(locale, 'permissions.save') })).toBeNull();
    });
    expect(client.getQueryData(listKey)).toEqual(page);
    refused = false;
    await act(async () => {
      await client.refetchQueries({ queryKey: listKey, exact: true });
    });
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(await screen.findByRole('button', { name: t(locale, 'permissions.save') })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  },
);

async function expectRetainedDraft(locale: 'ar' | 'en') {
  expect(await screen.findByRole('button', { name: t(locale, 'permissions.save') })).toBeTruthy();
  expect(
    screen.getByLabelText<HTMLInputElement>(t(locale, 'permissions.reason'), {
      selector: '#override-reason',
    }).value,
  ).toBe('Draft retained across refresh');
}

it.each(['ar', 'en'] as const)(
  'hides deferred refreshes, preserves a draft across transient failure and removes absent selection (%s)',
  async (locale) => {
    state.locale = locale;
    const { page, detail } = permissionResponses(false, undefined);
    const client = createQueryClient();
    clients.push(client);
    expect(client.getDefaultOptions().queries?.retry).toBe(false);
    const listKey = ['permissions', companyId, userId, null, 'memberships', undefined];
    let nextPage = page;
    let paused: Promise<void> | undefined;
    let release = () => {};
    let failed = false;
    state.get.mockImplementation(async (path: string) => {
      if (path === '/v1/permissions/memberships/{membershipId}') return { data: detail };
      if (path !== '/v1/permissions/memberships')
        throw new Error(`Unexpected test request: ${path}`);
      await paused;
      if (failed) throw new Error('Synthetic transient network failure');
      return { data: nextPage };
    });
    renderBrowser(client, undefined);
    fireEvent.click(await screen.findByRole('button', { name: t(locale, 'permissions.view') }));
    const reason = await screen.findByLabelText(t(locale, 'permissions.reason'), {
      selector: '#override-reason',
    });
    fireEvent.change(reason, { target: { value: 'Draft retained across refresh' } });
    const held = hold();
    paused = held.promise;
    release = held.release;
    let refreshed: Promise<void> | undefined;
    act(() => {
      refreshed = client.refetchQueries({ queryKey: listKey, exact: true });
    });
    await waitFor(() => expect(screen.queryByRole('table')).toBeNull());
    expect(screen.queryByRole('button', { name: t(locale, 'permissions.save') })).toBeNull();
    expect(
      screen.queryAllByRole('textbox', { name: t(locale, 'permissions.reason') }),
    ).toHaveLength(0);
    failed = true;
    await act(async () => {
      release();
      await refreshed;
    });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: t(locale, 'permissions.save') })).toBeNull();
    failed = false;
    paused = undefined;
    await act(() => client.refetchQueries({ queryKey: listKey, exact: true }));
    await expectRetainedDraft(locale);
    nextPage = { ...page, items: [] };
    await act(() => client.refetchQueries({ queryKey: listKey, exact: true }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: t(locale, 'permissions.save') })).toBeNull();
      expect(
        screen.queryAllByRole('textbox', { name: t(locale, 'permissions.reason') }),
      ).toHaveLength(0);
    });
    expect(client.getQueryData(listKey)).toEqual(nextPage);
  },
);
