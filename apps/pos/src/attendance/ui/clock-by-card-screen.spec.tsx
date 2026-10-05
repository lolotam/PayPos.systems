import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';

import { ClockByCardScreen } from './clock-by-card-screen';

const clock = vi.hoisted(() => vi.fn());
vi.mock('../api/clock-by-card', () => ({ clockByCard: clock }));

function show(locale: 'ar' | 'en') {
  return render(
    <DirectionProvider dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <LocaleProvider locale={locale} setLocale={() => undefined}>
        <ClockByCardScreen />
      </LocaleProvider>
    </DirectionProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  clock.mockReset();
});

describe('clock by card reception screen', () => {
  it.each(['ar', 'en'] as const)(
    'submits the scanned code on Enter and shows the accepted result in %s',
    async (locale) => {
      clock.mockResolvedValue({
        kind: 'accepted',
        result: {
          session_id: '01920000-0000-7000-8000-000000000001',
          operation: 'CLOCK_IN',
          working_date: '2026-10-05',
          accepted_at: '2026-10-05T08:00:00.000Z',
          exceptions: [],
          late_minutes: 0,
          missed_session_id: null,
        },
      });
      show(locale);
      const input = screen.getByLabelText(t(locale, 'pos.cardLabel'));
      fireEvent.change(input, { target: { value: ' CARD-1 ' } });
      fireEvent.submit(input.closest('form') as HTMLFormElement);
      await waitFor(() =>
        expect(clock).toHaveBeenCalledWith('CARD-1', expect.any(AbortSignal)),
      );
      expect(await screen.findByText(t(locale, 'personalAttendance.clockedIn'))).not.toBeNull();
    },
  );

  it.each(['ar', 'en'] as const)('explains a refused or unknown card in %s', async (locale) => {
    clock.mockResolvedValue({ kind: 'invalid' });
    show(locale);
    const input = screen.getByLabelText(t(locale, 'pos.cardLabel'));
    fireEvent.change(input, { target: { value: 'CARD-9' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(await screen.findByText(t(locale, 'pos.cardInvalid'))).not.toBeNull();
  });

  it('goes offline-only and waits for Enter without queueing the scan', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    show('en');
    expect(screen.getByText(t('en', 'pos.cardOffline'))).not.toBeNull();
    const input = screen.getByLabelText(t('en', 'pos.cardLabel'));
    fireEvent.change(input, { target: { value: 'CARD-1' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(clock).not.toHaveBeenCalled();
  });
});
