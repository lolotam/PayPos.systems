import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import type { Locale } from '@pospay/i18n';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QueryProvider } from '@/shared/api/query-provider';
import { LocaleProvider } from '@/shared/locale/locale-context';

import { WorkspaceProvider } from '../model/workspace-provider';
import { WorkspaceBody } from './workspace-body';

const USER = vi.hoisted(() => '01920000-0000-7000-8000-0000000000b1');

vi.mock('@/session/api/use-session', () => ({
  useSessionIdentity: () => ({ userId: USER, status: 'settled' as const }),
}));

const PLAN_ID = '01920000-0000-7000-8000-000000000001';
const POST_BODY = {
  name_en: 'Rehearsal Salon',
  name_ar: 'Salon Rehearsal',
  plan_id: PLAN_ID,
};

const ENVELOPE = (code: string, message: string) => ({
  code,
  message_ar: 'Synthetic refusal (ar fixture)',
  message_en: message,
});

/** The 201 answer in the exact Company schema shape from the contract. */
const CREATED_COMPANY = {
  id: '01920000-0000-7000-8000-000000000010',
  name_ar: 'Salon Rehearsal',
  name_en: 'Rehearsal Salon',
  owner_user_id: '01920000-0000-7000-8000-0000000000a1',
  plan_id: PLAN_ID,
  created_at: '2026-11-24T09:00:00Z',
  deleted_at: null,
};

/** The company as the workspaces read returns it after the success. */
const WORKSPACE_COMPANY = {
  id: CREATED_COMPANY.id,
  name_ar: CREATED_COMPANY.name_ar,
  name_en: CREATED_COMPANY.name_en,
  role_code: 'owner',
  scope: 'COMPANY',
  businesses: [],
};

const STORAGE_NAME = 'pospay.admin.create-company-attempt';
const STORED_KEY = '01920000-0000-7000-8000-0000000000f1';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const emptyWorkspaces = () => jsonResponse({ companies: [] }, 200);

function renderScreen(locale: Locale) {
  return render(
    <DirectionProvider dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <LocaleProvider locale={locale} setLocale={() => undefined}>
        <QueryProvider>
          <WorkspaceProvider>
            <WorkspaceBody>
              <div data-testid="dashboard-content">Dashboard</div>
            </WorkspaceBody>
          </WorkspaceProvider>
        </QueryProvider>
      </LocaleProvider>
    </DirectionProvider>,
  );
}

/** Routes GETs and POSTs through separate lanes in order; the last answer repeats when more is asked. */
function queue(
  gets: Array<(request: Request) => Response>,
  postsIn: Array<(request: Request) => Response> = [],
): { posts: Request[] } {
  const posts: Request[] = [];
  let nextGet = 0;
  let nextPost = 0;
  mockFetch.mockImplementation(async (input: Request | string, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.method === 'POST') {
      posts.push(request);
      const post = postsIn[Math.min(nextPost, postsIn.length - 1)] ?? emptyWorkspaces;
      nextPost += 1;
      return post(request);
    }
    const get = gets[Math.min(nextGet, gets.length - 1)] ?? emptyWorkspaces;
    nextGet += 1;
    return get(request);
  });
  return { posts };
}

async function fillAndSubmit(en = 'Rehearsal Salon', ar = 'Salon Rehearsal') {
  fireEvent.change(screen.getByLabelText(t('en', 'admin.companyNameEnLabel')), {
    target: { value: en },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'admin.companyNameArLabel')), {
    target: { value: ar },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'admin.createCompanySubmit') }));
}

async function waitForForm(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByLabelText(t('en', 'admin.companyNameEnLabel'))).not.toBeNull();
  });
}

function seedAttempt(overrides: { userId?: string; startedAt?: string } = {}): void {
  window.localStorage.setItem(
    STORAGE_NAME,
    JSON.stringify({
      userId: USER,
      key: STORED_KEY,
      body: POST_BODY,
      startedAt: new Date().toISOString(),
      ...overrides,
    }),
  );
}

function testFormVisible(): void {
  it('a user with no company sees the create form in English and in Arabic (RTL)', async () => {
    for (const locale of ['en', 'ar'] as const) {
      queue([emptyWorkspaces]);
      const { unmount } = renderScreen(locale);
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: t(locale, 'admin.createCompanyTitle') }),
        ).not.toBeNull();
      });
      expect(screen.getByLabelText(t(locale, 'admin.companyNameEnLabel'))).not.toBeNull();
      expect(screen.getByLabelText(t(locale, 'admin.companyNameArLabel'))).not.toBeNull();
      expect(
        screen.getByRole('button', { name: t(locale, 'admin.createCompanySubmit') }),
      ).not.toBeNull();
      unmount();
    }
  });
}

function testValidSubmit(): void {
  it('a valid submit sends one request with the names, the plan id and the key, then enters the new company', async () => {
    const { posts } = queue(
      [emptyWorkspaces, () => jsonResponse({ companies: [WORKSPACE_COMPANY] }, 200)],
      [() => jsonResponse(CREATED_COMPANY, 201)],
    );
    renderScreen('en');
    await waitForForm();
    await fillAndSubmit();
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-content')).not.toBeNull();
    });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toMatch(/\/v1\/companies$/);
    expect(posts[0]?.headers.get('idempotency-key')).toMatch(/[0-9a-f-]{36}/);
    expect(await posts[0]?.json()).toEqual(POST_BODY);
    expect(window.localStorage.getItem(STORAGE_NAME)).toBeNull();
    expect(screen.queryByRole('heading', { name: t('en', 'admin.createCompanyTitle') })).toBeNull();
  });
}

function testEmptyEnglishName(): void {
  it('an empty English name shows the field error and sends no request', async () => {
    const { posts } = queue([emptyWorkspaces]);
    renderScreen('en');
    await waitForForm();
    await fillAndSubmit('', 'Salon Rehearsal');
    expect(await screen.findByText(t('en', 'admin.nameEnRequired'))).not.toBeNull();
    expect(posts).toHaveLength(0);
  });
}

function testFieldErrorDescribed(): void {
  it('a field error is referenced by its input aria-describedby', async () => {
    queue([emptyWorkspaces]);
    renderScreen('en');
    await waitForForm();
    const input = screen.getByLabelText(t('en', 'admin.companyNameEnLabel'));
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: t('en', 'admin.createCompanySubmit') }));
    const describedBy = await screen.findByText(t('en', 'admin.nameEnRequired'));
    expect(describedBy.getAttribute('id')).not.toBeNull();
    expect(input.getAttribute('aria-describedby')).toBe(describedBy.getAttribute('id'));
  });
}

function testNetworkRetrySameKey(): void {
  it('a retry after a network failure locks the fields and resends the same key and body', async () => {
    const { posts } = queue(
      [emptyWorkspaces, () => jsonResponse({ companies: [WORKSPACE_COMPANY] }, 200)],
      [
        () => {
          throw new TypeError('network died');
        },
        () => jsonResponse(CREATED_COMPANY, 201),
      ],
    );
    renderScreen('en');
    await waitForForm();
    await fillAndSubmit();
    expect(await screen.findByRole('status')).not.toBeNull();
    expect(screen.getByText(t('en', 'admin.createCompanyRetryNotice'))).not.toBeNull();
    const nameInput = screen.getByLabelText(t('en', 'admin.companyNameEnLabel')) as HTMLInputElement;
    expect(nameInput.readOnly).toBe(true);
    expect(nameInput.value).toBe('Rehearsal Salon');
    const retry = screen.getByRole('button', { name: t('en', 'admin.createCompanyRetry') });
    expect(retry.getAttribute('disabled')).toBeNull();
    fireEvent.click(retry);
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-content')).not.toBeNull();
    });
    expect(posts).toHaveLength(2);
    expect(posts[1]?.headers.get('idempotency-key')).toBe(posts[0]?.headers.get('idempotency-key'));
    expect(await posts[1]?.json()).toEqual(POST_BODY);
  });
}

function testServer500Retry(): void {
  it('a 500 shows its own message in the locked retry state and the retry answer is the one that lands', async () => {
    const { posts } = queue(
      [emptyWorkspaces, () => jsonResponse({ companies: [WORKSPACE_COMPANY] }, 200)],
      [
        () => jsonResponse(ENVELOPE('UNEXPECTED', 'First refusal fixture'), 500),
        () => jsonResponse(CREATED_COMPANY, 201),
      ],
    );
    renderScreen('en');
    await waitForForm();
    await fillAndSubmit();
    expect(await screen.findByRole('status')).not.toBeNull();
    expect(screen.getByText('First refusal fixture')).not.toBeNull();
    const retry = screen.getByRole('button', { name: t('en', 'admin.createCompanyRetry') });
    expect(retry.getAttribute('disabled')).toBeNull();
    fireEvent.click(retry);
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-content')).not.toBeNull();
    });
    expect(screen.queryByText('First refusal fixture')).toBeNull();
    expect(posts).toHaveLength(2);
    expect(posts[1]?.headers.get('idempotency-key')).toBe(posts[0]?.headers.get('idempotency-key'));
  });
}

function testRemountKeepsAttempt(): void {
  it('an undecided attempt survives a remount and its retry reuses the same key', async () => {
    const { posts } = queue(
      [emptyWorkspaces, emptyWorkspaces, () => jsonResponse({ companies: [WORKSPACE_COMPANY] }, 200)],
      [
        () => {
          throw new TypeError('network died');
        },
        () => jsonResponse(CREATED_COMPANY, 201),
      ],
    );
    const first = renderScreen('en');
    await waitForForm();
    await fillAndSubmit();
    expect(await screen.findByRole('status')).not.toBeNull();
    first.unmount();
    renderScreen('en');
    const nameInput = await screen.findByLabelText(t('en', 'admin.companyNameEnLabel'));
    await waitFor(() => {
      expect((nameInput as HTMLInputElement).readOnly).toBe(true);
    });
    expect((nameInput as HTMLInputElement).value).toBe('Rehearsal Salon');
    fireEvent.click(screen.getByRole('button', { name: t('en', 'admin.createCompanyRetry') }));
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-content')).not.toBeNull();
    });
    expect(posts).toHaveLength(2);
    expect(posts[1]?.headers.get('idempotency-key')).toBe(posts[0]?.headers.get('idempotency-key'));
    expect(await posts[1]?.json()).toEqual(POST_BODY);
  });
}

function testForeignOrStaleAttempt(): void {
  it('another tab attempt locks a fresh screen, while a foreign or stale attempt is removed', async () => {
    queue([emptyWorkspaces, emptyWorkspaces, emptyWorkspaces]);
    seedAttempt();
    const first = renderScreen('en');
    const nameInput = await first.findByLabelText(t('en', 'admin.companyNameEnLabel'));
    await waitFor(() => {
      expect((nameInput as HTMLInputElement).readOnly).toBe(true);
    });
    expect((nameInput as HTMLInputElement).value).toBe('Rehearsal Salon');
    expect(first.getByRole('button', { name: t('en', 'admin.createCompanyRetry') })).not.toBeNull();

    seedAttempt({ userId: 'another-user' });
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_NAME }));
    await waitFor(() => {
      expect((first.getByLabelText(t('en', 'admin.companyNameEnLabel')) as HTMLInputElement).readOnly).toBe(false);
    });
    expect(window.localStorage.getItem(STORAGE_NAME)).toBeNull();
    first.unmount();

    seedAttempt({ userId: 'another-user' });
    const foreign = renderScreen('en');
    const foreignInput = await foreign.findByLabelText(t('en', 'admin.companyNameEnLabel'));
    expect((foreignInput as HTMLInputElement).readOnly).toBe(false);
    expect((foreignInput as HTMLInputElement).value).toBe('');
    expect(
      foreign.getByRole('button', { name: t('en', 'admin.createCompanySubmit') }).getAttribute('disabled'),
    ).toBeNull();
    expect(window.localStorage.getItem(STORAGE_NAME)).toBeNull();
    foreign.unmount();

    seedAttempt({ startedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() });
    const stale = renderScreen('en');
    const staleInput = await stale.findByLabelText(t('en', 'admin.companyNameEnLabel'));
    expect((staleInput as HTMLInputElement).readOnly).toBe(false);
    expect((staleInput as HTMLInputElement).value).toBe('');
    expect(window.localStorage.getItem(STORAGE_NAME)).toBeNull();
    stale.unmount();
  });
}

function testForbiddenAfterUnknown(): void {
  it('a 403 after an undecided attempt removes it, unlocks the form and the next submit uses a new key', async () => {
    const { posts } = queue(
      [emptyWorkspaces],
      [
        () => {
          throw new TypeError('network died');
        },
        () => jsonResponse(ENVELOPE('FORBIDDEN', 'Refusal fixture'), 403),
        () => jsonResponse(ENVELOPE('FORBIDDEN', 'Refusal fixture'), 403),
      ],
    );
    renderScreen('en');
    await waitForForm();
    await fillAndSubmit();
    expect(await screen.findByRole('status')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t('en', 'admin.createCompanyRetry') }));
    expect(await screen.findByText(t('en', 'admin.createCompanyForbidden'))).not.toBeNull();
    expect(window.localStorage.getItem(STORAGE_NAME)).toBeNull();
    await waitFor(() => {
      const nameInput = screen.getByLabelText(t('en', 'admin.companyNameEnLabel')) as HTMLInputElement;
      expect(nameInput.readOnly).toBe(false);
      expect(nameInput.value).toBe('Rehearsal Salon');
    });
    fireEvent.click(screen.getByRole('button', { name: t('en', 'admin.createCompanySubmit') }));
    await waitFor(() => {
      expect(posts).toHaveLength(3);
    });
    expect(posts[2]?.headers.get('idempotency-key')).not.toBe(posts[1]?.headers.get('idempotency-key'));
  });
}

function testSuccessWithReload(): void {
  it('after a 201 with a failing refresh the success state shows Reload, with no form, until the refresh lands', async () => {
    const { posts } = queue(
      [
        emptyWorkspaces,
        () => jsonResponse({ code: 'UNEXPECTED', message_ar: 'خطأ', message_en: 'Refresh failed fixture' }, 500),
        () => jsonResponse({ companies: [WORKSPACE_COMPANY] }, 200),
      ],
      [() => jsonResponse(CREATED_COMPANY, 201)],
    );
    renderScreen('en');
    await waitForForm();
    await fillAndSubmit();
    expect(await screen.findByText(t('en', 'admin.createCompanyCreatedStatus'))).not.toBeNull();
    expect(screen.queryByLabelText(t('en', 'admin.companyNameEnLabel'))).toBeNull();
    const reload = screen.getByRole('button', { name: t('en', 'admin.createCompanyReload') });
    fireEvent.click(reload);
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-content')).not.toBeNull();
    });
    expect(posts).toHaveLength(1);
  });
}

function testOfflineSubmit(): void {
  it('an offline submit fails at once into the locked retry state', async () => {
    const { posts } = queue(
      [emptyWorkspaces],
      [
        () => {
          throw new TypeError('offline');
        },
      ],
    );
    renderScreen('en');
    await waitForForm();
    onlineManager.setOnline(false);
    await fillAndSubmit();
    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });
    expect(await screen.findByText(t('en', 'admin.createCompanyRetryNotice'))).not.toBeNull();
    const nameInput = screen.getByLabelText(t('en', 'admin.companyNameEnLabel')) as HTMLInputElement;
    expect(nameInput.readOnly).toBe(true);
  });
}

describe('CreateCompanyScreen', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    window.localStorage.clear();
    onlineManager.setOnline(true);
  });

  afterEach(() => {
    onlineManager.setOnline(true);
  });

  testFormVisible();
  testValidSubmit();
  testEmptyEnglishName();
  testFieldErrorDescribed();
  testNetworkRetrySameKey();
  testServer500Retry();
  testRemountKeepsAttempt();
  testForeignOrStaleAttempt();
  testForbiddenAfterUnknown();
  testSuccessWithReload();
  testOfflineSubmit();
});
