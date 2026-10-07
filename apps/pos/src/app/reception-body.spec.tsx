import { act, render, screen, waitFor } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';

import { ReceptionBody } from './reception-body';

const calls = vi.hoisted(() => ({ probe: vi.fn(), clock: vi.fn() }));
vi.mock('@/staff-login/api/staff-calls', () => ({
  probeStaffSession: calls.probe,
  signOutStaff: vi.fn(),
}));
vi.mock('@/attendance/api/clock-by-card', () => ({ clockByCard: calls.clock }));
vi.mock('@/staff-login/ui/staff-login-screen', () => ({
  StaffLoginScreen: () => <h2>login</h2>,
}));
vi.mock('@/attendance/ui/attendance-home', () => ({
  AttendanceHome: () => <h2>attendance</h2>,
}));

function show(locale: 'ar' | 'en') {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DirectionProvider dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <LocaleProvider locale={locale} setLocale={() => undefined}>
          <ReceptionBody
            branchId="01923f66-3d2b-7c00-8000-000000000001"
            retry={async () => undefined}
          />
        </LocaleProvider>
      </DirectionProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  onlineManager.setOnline(true);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.stubGlobal('BroadcastChannel', undefined);
  calls.probe.mockResolvedValue({
    user_id: 'synthetic-operator',
    expires_at: 'synthetic-deadline',
  });
  calls.probe.mockClear();
  calls.clock.mockResolvedValue({ kind: 'invalid' });
  calls.clock.mockClear();
});

afterEach(() => {
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it.each(['en', 'ar'] as const)(
  'shows the card-clocking offline notice when the device disconnects in %s',
  async (locale) => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    show(locale);
    await waitFor(() => expect(calls.probe).toHaveBeenCalled());
    expect(await screen.findByRole('heading', { name: t(locale, 'pos.cardTitle') })).not.toBeNull();
    act(() => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(await screen.findByText(t(locale, 'pos.cardOffline'))).not.toBeNull();
    expect(screen.queryByText(t(locale, 'pos.cardSignedOut'))).toBeNull();
    expect(screen.queryByRole('heading', { name: t(locale, 'pos.cardTitle') })).toBeNull();
    expect(calls.clock).not.toHaveBeenCalled();
  },
);
