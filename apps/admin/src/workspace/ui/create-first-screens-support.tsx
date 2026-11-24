import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { Locale } from '@pospay/i18n';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import type { ReactNode } from 'react';
import { expect, vi } from 'vitest';

import { QueryProvider } from '@/shared/api/query-provider';
import { LocaleProvider } from '@/shared/locale/locale-context';

import { WorkspaceProvider } from '../model/workspace-provider';
import { WorkspaceBody } from './workspace-body';

const hoisted = vi.hoisted(() => ({
  companyId: '01920000-0000-7000-8000-0000000000c1',
  businessId: '01920000-0000-7000-8000-0000000000d1',
  branchId: '01920000-0000-7000-8000-0000000000e1',
}));

export const COMPANY_ID = hoisted.companyId;
export const BUSINESS_ID = hoisted.businessId;
export const BRANCH_ID = hoisted.branchId;

/** المتوقع في جسم POST النشاط: بدون country وبدون currency وبدون timezone. */
export const BUSINESS_BODY = {
  vertical_type: 'salon',
  name_en: 'Rehearsal Salon',
  name_ar: 'Salon Rehearsal',
};

export const BRANCH_BODY = { name_en: 'Main Branch', name_ar: 'الفرع الرئيسي' };

export const ENVELOPE = (code: string, message: string) => ({
  code,
  message_ar: 'Synthetic refusal (ar fixture)',
  message_en: message,
});

/** الرد 201 بالشكل اللي سكيما Business في العقد بتقبله بالظبط. */
export const CREATED_BUSINESS = {
  id: BUSINESS_ID,
  company_id: COMPANY_ID,
  vertical_type: 'salon',
  name_ar: 'Salon Rehearsal',
  name_en: 'Rehearsal Salon',
  currency: 'KWD',
  timezone: 'Asia/Kuwait',
  settings: {},
  created_at: '2026-11-24T09:00:00Z',
};

/** الرد 201 بالشكل اللي سكيما Branch في العقد بتقبله بالظبط. */
export const CREATED_BRANCH = {
  id: BRANCH_ID,
  company_id: COMPANY_ID,
  business_id: BUSINESS_ID,
  name_ar: 'الفرع الرئيسي',
  name_en: 'Main Branch',
  address_ar: null,
  address_en: null,
  geo: null,
  opening_hours: null,
  timezone: null,
  effective_timezone: 'Asia/Kuwait',
  is_active: true,
  created_at: '2026-11-24T09:05:00Z',
};

export const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// jsdom مش بيفعّل scrollIntoView وRadix Select بيناديه عند فتح القائمة على العنصر المختار.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => undefined);

export function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** شركة منشأة لسه ملهاش أنشطة — بتفتح شاشة أول نشاط. */
export const companyWithoutBusiness = () =>
  jsonResponse(
    {
      companies: [
        {
          id: COMPANY_ID,
          name_ar: null,
          name_en: 'Provider Company',
          role_code: 'owner',
          scope: 'COMPANY',
          businesses: [],
        },
      ],
    },
    200,
  );

export const WORKSPACE_BUSINESS = {
  id: BUSINESS_ID,
  name_ar: 'Salon Rehearsal',
  name_en: 'Rehearsal Salon',
  business_type: 'salon',
  country: 'KW',
  branches: [] as unknown[],
};

/** النشاط موجود ولسه ملوش فروع — بتفتح شاشة أول فرع. */
export const companyWithBusinessNoBranch = () =>
  jsonResponse(
    {
      companies: [
        {
          id: COMPANY_ID,
          name_ar: null,
          name_en: 'Provider Company',
          role_code: 'owner',
          scope: 'COMPANY',
          businesses: [WORKSPACE_BUSINESS],
        },
      ],
    },
    200,
  );

/** النشاط له فرع — بتفتح محتوى اللوحة العادي بالنشاط والفرع مختارين. */
export const companyWithBusinessAndBranch = () =>
  jsonResponse(
    {
      companies: [
        {
          id: COMPANY_ID,
          name_ar: null,
          name_en: 'Provider Company',
          role_code: 'owner',
          scope: 'COMPANY',
          businesses: [
            {
              ...WORKSPACE_BUSINESS,
              branches: [
                {
                  id: BRANCH_ID,
                  name_ar: 'الفرع الرئيسي',
                  name_en: 'Main Branch',
                  effective_timezone: 'Asia/Kuwait',
                  is_active: true,
                },
              ],
            },
          ],
        },
      ],
    },
    200,
  );

type Answer = (request: Request) => Response;

/**
 * بيوجّه الطلبات لمسارات منفصلة بالترتيب: آخر جواب بيتكرر لو اتطلب أكتر، والـ PUT بيرجع نجاح
 * افتراضي والـ POST بيرجع 500 لو مفيش جواب متجهّز — عشان الاختبار يفشل بدل ما يترصّن.
 */
export function queue(lanes: { gets?: Answer[]; posts?: Answer[]; puts?: Answer[] } = {}): {
  posts: Request[];
  puts: Request[];
} {
  const posts: Request[] = [];
  const puts: Request[] = [];
  let nextGet = 0;
  let nextPost = 0;
  let nextPut = 0;
  mockFetch.mockImplementation(async (input: Request | string, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.method === 'POST') {
      posts.push(request);
      const post = lanes.posts?.[Math.min(nextPost, (lanes.posts.length ?? 1) - 1)];
      nextPost += 1;
      return post ? post(request) : jsonResponse(ENVELOPE('UNEXPECTED', 'No POST answer staged'), 500);
    }
    if (request.method === 'PUT') {
      puts.push(request);
      const put = lanes.puts?.[Math.min(nextPut, (lanes.puts.length ?? 1) - 1)];
      nextPut += 1;
      return put ? put(request) : jsonResponse({ business_id: BUSINESS_ID, country: 'KW' }, 200);
    }
    const get = lanes.gets?.[Math.min(nextGet, (lanes.gets.length ?? 1) - 1)];
    nextGet += 1;
    return get ? get(request) : companyWithoutBusiness();
  });
  return { posts, puts };
}

export function renderScreen(locale: Locale, probe: ReactNode, client?: QueryClient) {
  const gates = (
    <WorkspaceProvider>
      <WorkspaceBody>{probe}</WorkspaceBody>
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

export async function waitForBusinessForm(locale: Locale = 'en'): Promise<void> {
  await waitFor(() => {
    expect(screen.getByLabelText(t(locale, 'admin.businessNameEnLabel'))).not.toBeNull();
  });
}

export async function waitForBranchForm(locale: Locale = 'en'): Promise<void> {
  await waitFor(() => {
    expect(screen.getByLabelText(t(locale, 'admin.branchNameEnLabel'))).not.toBeNull();
  });
}

export async function chooseCountry(label: string): Promise<void> {
  const trigger = screen.getByRole('combobox', { name: t('en', 'admin.businessCountryLabel') });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const option = await screen.findByRole('option', { name: label });
  fireEvent.click(option);
}

export async function fillBusinessAndSubmit(en = 'Rehearsal Salon', ar = 'Salon Rehearsal'): Promise<void> {
  fireEvent.change(screen.getByLabelText(t('en', 'admin.businessNameEnLabel')), {
    target: { value: en },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'admin.businessNameArLabel')), {
    target: { value: ar },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'admin.firstBusinessSubmit') }));
}

export async function fillBranchAndSubmit(en = 'Main Branch', ar = 'الفرع الرئيسي'): Promise<void> {
  fireEvent.change(screen.getByLabelText(t('en', 'admin.branchNameEnLabel')), {
    target: { value: en },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'admin.branchNameArLabel')), {
    target: { value: ar },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'admin.firstBranchSubmit') }));
}
