import { membershipPermissions, permissionMembershipPage } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/shared/api/query-client';

import { PermissionMembershipBrowser } from './permission-membership-browser';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en', get: vi.fn() }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get }) }));

const companyId = '01920000-0000-7000-8000-0000000000a0';
const businessId = '01920000-0000-7000-8000-0000000000b0';
const membershipId = '01920000-0000-7000-8000-0000000000c0';
const holderId = '01920000-0000-7000-8000-0000000000d0';
const userId = '01920000-0000-7000-8000-0000000000e0';
const clients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
  state.get.mockReset();
});

function permissionResponses(businessScoped: boolean, business: string | undefined) {
  const membership = {
    id: membershipId,
    user_id: holderId,
    employee_id: null,
    role_code: 'viewer',
    role_name_ar: null,
    role_name_en: 'Viewer',
    scope_type: businessScoped ? 'BUSINESS' : 'COMPANY',
    scope_id: business ?? companyId,
    starts_at: '2026-01-01T00:00:00Z',
    ends_at: null,
  };
  const page = permissionMembershipPage.parse({ items: [membership], next_cursor: null });
  const detail = membershipPermissions.parse({
    membership,
    role_defaults: ['read:memberships:company'],
    permission_catalog: ['read:memberships:company'],
    overrides: { items: [], next_cursor: null },
    ended_overrides: { items: [], next_cursor: null },
    editing_enabled: true,
    discount_limit: { limit_bps: null },
  });
  return { page, detail };
}

function renderBrowser(client: QueryClient, business: string | undefined) {
  render(
    <QueryClientProvider client={client}>
      <PermissionMembershipBrowser
        companyId={companyId}
        userId={userId}
        businessId={business}
        branchTimeZones={{}}
        scopeNames={{}}
      />
    </QueryClientProvider>,
  );
}

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
    paused = new Promise<void>((resolve) => {
      release = resolve;
    });
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
