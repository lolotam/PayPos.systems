import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { afterEach, expect, it, vi } from 'vitest';

import { QueryProvider } from '@/shared/api/query-provider';
import * as clientModule from '@/shared/api/client';
import { writeSelection, clearSelection } from '@/shared/api/selection-cookie';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { NotificationBell } from './notification-bell';

const companyId = '01920000-0000-7000-8000-0000000000a0';
const otherCompany = '01920000-0000-7000-8000-0000000000b0';
afterEach(() => {
  vi.restoreAllMocks();
  clearSelection();
});

function sampleItem(locale: 'ar' | 'en', read: boolean) {
  return {
    id: '01920000-0000-7000-8000-0000000000c1',
    company_id: companyId,
    business_id: null,
    branch_id: null,
    source_event_id: '01920000-0000-7000-8000-0000000000c2',
    template_key: 'generic_notice',
    template_revision: 1,
    locale,
    safe_parameters: [{ name: 'subject', type: 'text', value: 'Synthetic subject' }],
    created_at: '2026-10-01T12:00:00Z',
    read_at: read ? '2026-10-01T13:00:00Z' : null,
  };
}

it.each(['ar', 'en'] as const)(
  'shows badge, template and read state; mark all updates count and list in %s',
  async (locale) => {
    vi.spyOn(clientModule, 'apiClient').mockImplementation(clientModule.createApiClient);
    let read = false;
    // A stale cookie must not override the explicit company attached to this query key.
    writeSelection({ companyId: otherCompany });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const request = input as Request;
      expect(request.headers.get('x-company-id')).toBe(companyId);
      const path = new URL(request.url).pathname;
      if (path.endsWith('/read-all')) {
        read = true;
        return response({ ok: true });
      }
      if (path.endsWith('/unread-count')) return response({ count: read ? 0 : 3 });
      return response({ items: [sampleItem(locale, read)], next_cursor: null });
    });
    render(
      <DirectionProvider dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <LocaleProvider locale={locale} setLocale={() => undefined}>
          <QueryProvider>
            <NotificationBell companyId={companyId} userId="01920000-0000-7000-8000-0000000000f1" />
          </QueryProvider>
        </LocaleProvider>
      </DirectionProvider>,
    );
    expect((await screen.findByLabelText(`${t(locale, 'inApp.unread')}: 3`)).textContent).toBe('3');
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'inApp.title') }));
    expect(
      await screen.findByText(
        t(locale, 'inApp.generic_notice').replace('{{subject}}', 'Synthetic subject'),
      ),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'inApp.markAllRead') }));
    await waitFor(() =>
      expect(screen.queryByLabelText(`${t(locale, 'inApp.unread')}: 3`)).toBeNull(),
    );
    expect(await screen.findByText(t(locale, 'inApp.read'))).not.toBeNull();
    expect(fetchSpy.mock.calls.some(([input]) => (input as Request).method === 'POST')).toBe(true);
    const region = screen.getByRole('region', { name: t(locale, 'inApp.title') });
    if (locale === 'ar') expect(region.closest('[dir="rtl"]')).not.toBeNull();
    fireEvent.keyDown(screen.getByRole('button', { name: t(locale, 'inApp.title') }), {
      key: 'Escape',
    });
    expect(screen.queryByRole('region')).toBeNull();
  },
);

it.each(['ar', 'en'] as const)(
  'renders the not-clocked-in template in viewer locale %s when the stored locale differs',
  async (locale) => {
    const stored = locale === 'ar' ? 'en' : 'ar';
    vi.spyOn(clientModule, 'apiClient').mockImplementation(clientModule.createApiClient);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = new URL((input as Request).url).pathname;
      if (path.endsWith('/unread-count')) return response({ count: 1 });
      return response({
        items: [
          {
            ...sampleItem(stored, false),
            template_key: 'shift_not_clocked_in',
            safe_parameters: [
              { name: 'employee_name_ar', type: 'text', value: 'Arabic slot employee' },
              { name: 'employee_name_en', type: 'text', value: 'English slot employee' },
              { name: 'branch_name_ar', type: 'text', value: 'Arabic slot branch' },
              { name: 'branch_name_en', type: 'text', value: 'English slot branch' },
              { name: 'shift_start', type: 'text', value: '10:00' },
            ],
          },
        ],
        next_cursor: null,
      });
    });
    render(
      <DirectionProvider dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <LocaleProvider locale={locale} setLocale={() => undefined}>
          <QueryProvider>
            <NotificationBell companyId={companyId} userId="01920000-0000-7000-8000-0000000000f1" />
          </QueryProvider>
        </LocaleProvider>
      </DirectionProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: t(locale, 'inApp.title') }));
    const text = t(locale, 'inApp.shift_not_clocked_in')
      .replace(
        locale === 'ar' ? '{{employee_name_ar}}' : '{{employee_name_en}}',
        locale === 'ar' ? 'Arabic slot employee' : 'English slot employee',
      )
      .replace(
        locale === 'ar' ? '{{branch_name_ar}}' : '{{branch_name_en}}',
        locale === 'ar' ? 'Arabic slot branch' : 'English slot branch',
      )
      .replace('{{shift_start}}', '10:00');
    expect(await screen.findByText(text)).not.toBeNull();
  },
);

it.each(['ar', 'en'] as const)(
  'hides badge at zero and shows empty state in %s',
  async (locale) => {
    vi.spyOn(clientModule, 'apiClient').mockImplementation(clientModule.createApiClient);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = new URL((input as Request).url).pathname;
      if (path.endsWith('/unread-count')) return response({ count: 0 });
      return response({ items: [], next_cursor: null });
    });
    render(
      <DirectionProvider dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <LocaleProvider locale={locale} setLocale={() => undefined}>
          <QueryProvider>
            <NotificationBell companyId={companyId} userId="01920000-0000-7000-8000-0000000000f1" />
          </QueryProvider>
        </LocaleProvider>
      </DirectionProvider>,
    );
    expect(screen.queryByLabelText(new RegExp(`^${t(locale, 'inApp.unread')}:`))).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'inApp.title') }));
    expect(await screen.findByText(t(locale, 'inApp.empty'))).not.toBeNull();
    const region = screen.getByRole('region', { name: t(locale, 'inApp.title') });
    if (locale === 'ar') expect(region.closest('[dir="rtl"]')).not.toBeNull();
  },
);

function response(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
