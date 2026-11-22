import { t } from '@pospay/i18n';
import { act, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import {
  choosePackageSaleCustomer as chooseCustomer,
  packageSaleCustomer,
  renderPackageSaleForm as renderForm,
  resetPackageSaleFormTest,
} from './package-sale-status.fixture';

const state = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  locale: 'en' as 'ar' | 'en',
  outcome: 'pending' as 'pending' | 'completed' | 'failed',
  sellerFailures: 0,
  recorderIds: null as string[] | null,
  sellerIds: null as string[] | null,
  sellerPages: null as Record<string, string[]> | null,
  entryScope: 'BRANCH' as 'COMPANY' | 'BUSINESS' | 'BRANCH' | null,
  contextAnchor: '2026-10-01T08:00:00.000Z',
  contextDenied: false,
}));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get, POST: state.post }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

const profilePath = '/v1/branches/{branchId}/customers/{customerId}/profile';
const profileResponse = {
  data: {
    ...packageSaleCustomer,
    birthday: null,
    gender: null,
    email: 'private@example.test',
    notes: [],
  },
  response: { status: 200 },
};

function serveProfile(reply: (signal: AbortSignal) => unknown | Promise<unknown>) {
  const read = state.get.getMockImplementation();
  if (!read) throw new Error('Missing package sale network fixture');
  state.get.mockImplementation((path: string, init: { signal: AbortSignal }) => {
    if (path === profilePath) return Promise.resolve(reply(init.signal));
    if (path.endsWith('/package-sales/context') && state.contextDenied) {
      return Promise.resolve({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
    }
    return read(path, init);
  });
}

beforeEach(() => {
  resetPackageSaleFormTest(state);
  state.contextDenied = false;
});

async function refreshContext(view: ReturnType<typeof renderForm>) {
  await act(async () => {
    await view.client.refetchQueries({ queryKey: ['package-sale-context'] });
  });
}

const profileName = t('en', 'serviceSessions.profileCard');
const packagesLink = t('en', 'customerPackages.open');

it.each(['unavailable scope', 'HTTP refusal'] as const)(
  'drops the private card and selection on %s and requires a new selection on restore',
  async (reason) => {
    serveProfile(() => profileResponse);
    const view = renderForm();
    await chooseCustomer(state);
    expect(await screen.findByRole('region', { name: profileName })).toBeTruthy();
    expect(screen.getByText('private@example.test')).toBeTruthy();
    expect(screen.getByRole('link', { name: packagesLink })).toBeTruthy();

    state.entryScope = reason === 'unavailable scope' ? null : 'BRANCH';
    state.contextDenied = reason === 'HTTP refusal';
    await refreshContext(view);
    await screen.findByText(t('en', 'packageSale.customerUnavailable'));
    expect(screen.queryByRole('region', { name: profileName })).toBeNull();
    expect(screen.queryByRole('link', { name: packagesLink })).toBeNull();

    state.entryScope = 'BRANCH';
    state.contextDenied = false;
    await refreshContext(view);
    await screen.findByRole('button', { name: t('en', 'serviceSessions.findOrCreate') });
    expect(screen.queryAllByText(packageSaleCustomer.name)).toHaveLength(0);
    expect(screen.queryByText('private@example.test')).toBeNull();
  },
);

it('does not use the old customer when switching between two authorized scopes', async () => {
  serveProfile(() => profileResponse);
  const view = renderForm();
  await chooseCustomer(state);
  const before = state.get.mock.calls.filter(([path]) => String(path).endsWith('/profile')).length;
  state.entryScope = 'BUSINESS';
  await refreshContext(view);
  await waitFor(() => expect(screen.queryAllByText(packageSaleCustomer.name)).toHaveLength(0));
  expect(screen.queryByRole('region', { name: profileName })).toBeNull();
  expect(state.get.mock.calls.filter(([path]) => String(path).endsWith('/profile')).length).toBe(before);
});

it('drops the active selection and rechecks context on an explicit profile denial', async () => {
  serveProfile(() => ({ error: { code: 'FORBIDDEN' }, response: { status: 403 } }));
  renderForm();
  await chooseCustomer(state);
  const contextsBefore = state.get.mock.calls.filter(([path]) => String(path).endsWith('/package-sales/context')).length;
  await waitFor(() => expect(screen.queryAllByText(packageSaleCustomer.name)).toHaveLength(0));
  expect(screen.queryByRole('region', { name: profileName })).toBeNull();
  await waitFor(() => expect(state.get.mock.calls.filter(([path]) => String(path).endsWith('/package-sales/context')).length).toBeGreaterThan(contextsBefore));
});

it('cancels a held scoped profile read when authority is revoked', async () => {
  let finish!: (value: typeof profileResponse) => void;
  let signal: AbortSignal | undefined;
  serveProfile((requestSignal) => {
    signal = requestSignal;
    return new Promise((resolve) => { finish = resolve; });
  });
  const view = renderForm();
  await chooseCustomer(state);
  await waitFor(() => expect(signal?.aborted).toBe(false));

  state.entryScope = null;
  await refreshContext(view);
  await waitFor(() => expect(signal?.aborted).toBe(true));
  await act(async () => { finish(profileResponse); });

  expect(screen.queryByRole('region', { name: profileName })).toBeNull();
  expect(screen.queryByText('private@example.test')).toBeNull();
  expect(state.get.mock.calls.filter(([path]) => String(path).endsWith('/profile'))).toHaveLength(1);
});
