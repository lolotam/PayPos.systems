import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DirectionProvider } from '@pospay/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';

import { ClockByCardScreen } from './clock-by-card-screen';

const clock = vi.hoisted(() => vi.fn());
vi.mock('../api/clock-by-card', () => ({ clockByCard: clock }));

function show(
  locale: 'ar' | 'en',
  cache = new QueryClient(),
  onRejected: () => Promise<void> = async () => undefined,
) {
  return render(
    <QueryClientProvider client={cache}>
      <DirectionProvider dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <LocaleProvider locale={locale} setLocale={() => undefined}>
          <ClockByCardScreen onRejected={onRejected} />
        </LocaleProvider>
      </DirectionProvider>
    </QueryClientProvider>,
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
      await waitFor(() => expect(clock).toHaveBeenCalledWith('CARD-1', expect.any(AbortSignal)));
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

describe('card credential lifetime and scanner focus', () => {
  it('masks the scan, clears it immediately and ignores a second submit while pending', async () => {
    let finish: ((value: { kind: 'invalid' }) => void) | undefined;
    clock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    show('en');
    const input = screen.getByLabelText(t('en', 'pos.cardLabel')) as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.classList.contains('card-code-mask')).toBe(true);
    expect(input.autocomplete).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.getAttribute('autocapitalize')).toBe('off');
    fireEvent.change(input, { target: { value: 'SYNTHETIC-CARD' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(input.value).toBe('');
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(clock).toHaveBeenCalledTimes(1);
    finish?.({ kind: 'invalid' });
    await screen.findByText(t('en', 'pos.cardInvalid'));
    expect(document.activeElement).toBe(input);
  });

  it.each(['offline', 'operator', 'unmount'])(
    'aborts a pending scan on %s and ignores its late result',
    async (reason) => {
      clock.mockImplementation(() => new Promise(() => undefined));
      const cache = new QueryClient();
      cache.setQueryData(['staff-session', 0], { user_id: 'synthetic-user' });
      const view = show('en', cache);
      const input = screen.getByLabelText(t('en', 'pos.cardLabel')) as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'SYNTHETIC-CARD' } });
      fireEvent.submit(input.closest('form') as HTMLFormElement);
      const signal = clock.mock.calls[0]?.[1] as AbortSignal;
      if (reason === 'offline') fireEvent(window, new Event('offline'));
      else if (reason === 'operator') cache.clear();
      else view.unmount();
      await waitFor(() => expect(signal.aborted).toBe(true));
      expect(input.value).toBe('');
    },
  );
});

it.each(['ar', 'en'] as const)(
  'explains signed-out operators and refreshes both session contexts in %s',
  async (locale) => {
    clock.mockResolvedValue({ kind: 'signed-out' });
    const cache = new QueryClient();
    const refetch = vi.spyOn(cache, 'invalidateQueries');
    const retry = vi.fn(async () => undefined);
    show(locale, cache, retry);
    const input = screen.getByLabelText(t(locale, 'pos.cardLabel')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'SYNTHETIC-CARD' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(await screen.findByText(t(locale, 'pos.cardSignedOut'))).not.toBeNull();
    expect(refetch).toHaveBeenCalledWith({ queryKey: ['staff-session'] });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(input.disabled).toBe(true);
  },
);
