import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Locale } from '@pospay/i18n';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { QueryProvider } from '@/shared/api/query-provider';
import { LocaleProvider } from '@/shared/locale/locale-context';

import { WorkspaceProvider } from '../model/workspace-provider';
import { WorkspaceBody } from './workspace-body';

const POST_BODY = {
  name_en: 'Rehearsal Salon',
  name_ar: 'Salon Rehearsal',
  plan_id: '01920000-0000-7000-8000-000000000001',
};

const ENVELOPE = (code: string) => ({
  code,
  message_ar: 'Synthetic refusal (ar fixture)',
  message_en: 'The request is not valid.',
});

/** The 201 answer in the exact Company schema shape from the contract. */
const CREATED_COMPANY = {
  id: '01920000-0000-7000-8000-000000000010',
  name_ar: 'Salon Rehearsal',
  name_en: 'Rehearsal Salon',
  owner_user_id: '01920000-0000-7000-8000-0000000000a1',
  plan_id: POST_BODY.plan_id,
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

function testForbidden(): void {
  it('a 403 refusal shows the alert, keeps the values and does not refetch workspaces', async () => {
    let reads = 0;
    const { posts } = queue(
      [
        () => {
          reads += 1;
          return emptyWorkspaces();
        },
      ],
      [() => jsonResponse({ ...ENVELOPE('FORBIDDEN'), details: [] }, 403)],
    );
    renderScreen('en');
    await waitForForm();
    await fillAndSubmit();
    expect(await screen.findByRole('alert')).not.toBeNull();
    expect(screen.getByText(t('en', 'admin.createCompanyForbidden'))).not.toBeNull();
    const nameInput = screen.getByLabelText(t('en', 'admin.companyNameEnLabel')) as HTMLInputElement;
    expect(nameInput.value).toBe('Rehearsal Salon');
    expect(posts).toHaveLength(1);
    expect(reads).toBe(1);
  });
}

function testNetworkRetrySameKey(): void {
  it('a retry after a network failure reuses the same idempotency key', async () => {
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
    expect(await screen.findByRole('alert')).not.toBeNull();
    expect(screen.getByText(t('en', 'admin.unexpected'))).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t('en', 'admin.createCompanySubmit') }));
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-content')).not.toBeNull();
    });
    expect(posts).toHaveLength(2);
    expect(posts[1]?.headers.get('idempotency-key')).toBe(posts[0]?.headers.get('idempotency-key'));
  });
}

function testForbiddenNewKey(): void {
  it('a new attempt after a 403 uses a new idempotency key', async () => {
    const { posts } = queue(
      [emptyWorkspaces],
      [() => jsonResponse(ENVELOPE('FORBIDDEN'), 403), () => jsonResponse(ENVELOPE('FORBIDDEN'), 403)],
    );
    renderScreen('en');
    await waitForForm();
    await fillAndSubmit();
    expect(await screen.findByRole('alert')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t('en', 'admin.createCompanySubmit') }));
    await waitFor(() => {
      expect(posts).toHaveLength(2);
    });
    expect(posts[1]?.headers.get('idempotency-key')).not.toBe(posts[0]?.headers.get('idempotency-key'));
  });
}

function testUnknownPlanAndServer500(): void {
  it('unknown_plan and a 500 show an error alert and keep the form usable', async () => {
    const { posts } = queue(
      [emptyWorkspaces],
      [
        () =>
          jsonResponse(
            { ...ENVELOPE('VALIDATION_FAILED'), details: [{ path: ['plan_id'], code: 'unknown_plan' }] },
            422,
          ),
        () => jsonResponse(ENVELOPE('UNEXPECTED'), 500),
      ],
    );
    renderScreen('en');
    await waitForForm();
    await fillAndSubmit();
    expect(await screen.findByRole('alert')).not.toBeNull();
    expect(screen.getByText('The request is not valid.')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t('en', 'admin.createCompanySubmit') }));
    await waitFor(() => {
      expect(posts).toHaveLength(2);
    });
    expect(screen.getByRole('alert')).not.toBeNull();
    expect(screen.getByLabelText(t('en', 'admin.companyNameEnLabel'))).not.toBeNull();
  });
}

describe('CreateCompanyScreen', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterAll(() => {
    mockFetch.mockRestore?.();
  });

  testFormVisible();
  testValidSubmit();
  testEmptyEnglishName();
  testForbidden();
  testNetworkRetrySameKey();
  testForbiddenNewKey();
  testUnknownPlanAndServer500();
});
