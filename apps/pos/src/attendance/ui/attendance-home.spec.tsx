import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';

import { AttendanceHome } from './attendance-home';

const qr = vi.hoisted(() => vi.fn());
vi.mock('../api/use-attendance-qr', () => ({ useAttendanceQr: qr }));
const branchId = '01920000-0000-7000-8000-000000000001';
const AR_BRANCH = String.fromCodePoint(0x641, 0x631, 0x639);

function show(locale: 'ar' | 'en') {
  return render(
    <DirectionProvider dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <LocaleProvider locale={locale} setLocale={() => undefined}>
        <AttendanceHome branchId={branchId} onRejected={async () => undefined} />
      </LocaleProvider>
    </DirectionProvider>,
  );
}

describe('paired attendance screen', () => {
  it.each(['ar', 'en'] as const)(
    'shows a real QR, localized branch and branch-time clock in %s',
    (locale) => {
      qr.mockReturnValue({
        branch: {
          id: branchId,
          name_ar: AR_BRANCH,
          name_en: 'Test branch',
          effective_timezone: 'Asia/Kuwait',
        },
        payload: JSON.stringify({ branch_id: branchId, window: 1, sig: 'ab'.repeat(32) }),
        now: new Date('2026-10-02T12:00:00.000Z'),
        notice: 'loading',
        retry: vi.fn(),
      });
      show(locale);
      expect(
        screen.getByRole('img', { name: t(locale, 'pos.attendanceQrLabel') }).querySelector('path'),
      ).not.toBeNull();
      expect(screen.getByText(locale === 'ar' ? AR_BRANCH : 'Test branch')).not.toBeNull();
      expect(screen.getByText('15:00:00')).not.toBeNull();
    },
  );

  it.each(['ar', 'en'] as const)('explains offline behavior with no QR in %s', (locale) => {
    qr.mockReturnValue({
      branch: undefined,
      payload: null,
      now: null,
      notice: 'offline',
      retry: vi.fn(),
    });
    show(locale);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(t(locale, 'pos.attendanceOffline'))).not.toBeNull();
    expect(screen.getByRole('button', { name: t(locale, 'pos.retry') })).not.toBeNull();
  });
});
