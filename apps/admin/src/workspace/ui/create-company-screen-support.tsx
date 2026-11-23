import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { Locale } from '@pospay/i18n';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { expect, vi } from 'vitest';

import { QueryProvider } from '@/shared/api/query-provider';
import { LocaleProvider } from '@/shared/locale/locale-context';

import { WorkspaceProvider } from '../model/workspace-provider';
import { WorkspaceBody } from './workspace-body';

vi.mock('@/session/api/use-session', () => ({
  useSessionIdentity: () => ({ userId: USER, status: 'settled' as const }),
}));

export const USER = vi.hoisted(() => '01920000-0000-7000-8000-0000000000b1');
export const PLAN_ID = '01920000-0000-7000-8000-000000000001';
export const POST_BODY = {
  name_en: 'Rehearsal Salon',
  name_ar: 'Salon Rehearsal',
  plan_id: PLAN_ID,
};

export const ENVELOPE = (code: string, message: string) => ({
  code,
  message_ar: 'Synthetic refusal (ar fixture)',
  message_en: message,
});

/** The 201 answer in the exact Company schema shape from the contract. */
export const CREATED_COMPANY = {
  id: '01920000-0000-7000-8000-000000000010',
  name_ar: 'Salon Rehearsal',
  name_en: 'Rehearsal Salon',
  owner_user_id: '01920000-0000-7000-8000-0000000000a1',
  plan_id: PLAN_ID,
  created_at: '2026-11-24T09:00:00Z',
  deleted_at: null,
};

/** The company as the workspaces read returns it after the success. */
export const WORKSPACE_COMPANY = {
  id: CREATED_COMPANY.id,
  name_ar: CREATED_COMPANY.name_ar,
  name_en: CREATED_COMPANY.name_en,
  role_code: 'owner',
  scope: 'COMPANY',
  businesses: [],
};

export const STORAGE_NAME = 'pospay.admin.create-company-attempt';
export const STORED_KEY = '01920000-0000-7000-8000-0000000000f1';

export const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

export function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const emptyWorkspaces = () => jsonResponse({ companies: [] }, 200);

export function renderScreen(locale: Locale, client?: QueryClient) {
  const gates = (
    <WorkspaceProvider>
      <WorkspaceBody>
        <div data-testid="dashboard-content">Dashboard</div>
      </WorkspaceBody>
    </WorkspaceProvider>
  );
  return render(
    <DirectionProvider dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <LocaleProvider locale={locale} setLocale={() => undefined}>
        {client ? (
          <QueryClientProvider client={client}>{gates}</QueryClientProvider>
        ) : (
          <QueryProvider>{gates}</QueryProvider>
        )}
      </LocaleProvider>
    </DirectionProvider>,
  );
}

/** Routes GETs and POSTs through separate lanes in order; the last answer repeats when more is asked. */
export function queue(
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

export async function fillAndSubmit(en = 'Rehearsal Salon', ar = 'Salon Rehearsal') {
  fireEvent.change(screen.getByLabelText(t('en', 'admin.companyNameEnLabel')), {
    target: { value: en },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'admin.companyNameArLabel')), {
    target: { value: ar },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'admin.createCompanySubmit') }));
}

export async function waitForForm(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByLabelText(t('en', 'admin.companyNameEnLabel'))).not.toBeNull();
  });
}

export function seedAttempt(
  overrides: { userId?: string; startedAt?: string; created?: boolean } = {},
): void {
  window.localStorage.setItem(
    STORAGE_NAME,
    JSON.stringify({
      userId: USER,
      key: STORED_KEY,
      body: POST_BODY,
      startedAt: new Date().toISOString(),
      ...(overrides.created ? { createdAt: new Date().toISOString() } : {}),
      ...overrides,
    }),
  );
}
