import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { setDeviceTokenReader } from '@/shared/api/device-auth';
import { LocaleProvider } from '@/shared/locale/locale-context';

import { ClockByCardScreen } from './clock-by-card-screen';

// العميل يحتفظ بـ fetch عند إنشائه؛ نفس الحد الصناعي يظل صالحًا بين الحالات.
const transport = vi.fn<(request: Request) => Promise<Response>>();
type Locale = 'ar' | 'en';

beforeEach(() => {
  transport.mockReset();
  transport.mockRejectedValue(new TypeError('Unexpected synthetic request'));
  vi.stubGlobal('fetch', transport);
  setDeviceTokenReader(async () => 'synthetic-device-credential');
});

afterEach(() => {
  cleanup();
  setDeviceTokenReader(async () => null);
  vi.unstubAllGlobals();
});

function show(locale: Locale = 'en') {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cache}>
      <DirectionProvider dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <LocaleProvider locale={locale} setLocale={() => undefined}>
          <ClockByCardScreen />
        </LocaleProvider>
      </DirectionProvider>
    </QueryClientProvider>,
  );
}

function scan(locale: Locale = 'en', value = ' SYNTHETIC-CARD ') {
  const input = screen.getByLabelText(t(locale, 'pos.cardLabel')) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest('form') as HTMLFormElement);
  return input;
}

function accepted(operation: 'CLOCK_IN' | 'CLOCK_OUT' = 'CLOCK_IN') {
  return Response.json({
    session_id: '01920000-0000-7000-8000-000000000001',
    operation,
    working_date: '2026-10-05',
    accepted_at: '2026-10-05T08:00:00.000Z',
    exceptions: [],
    late_minutes: 0,
    missed_session_id: null,
  });
}

function holdRequest() {
  let finish!: (response: Response) => void;
  transport.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  return async () => {
    await act(async () => {
      finish(accepted());
    });
  };
}

async function requestAt(index = 0) {
  await waitFor(() => expect(transport.mock.calls.length).toBeGreaterThan(index));
  const request = transport.mock.calls[index]?.[0];
  expect(request).toBeInstanceOf(Request);
  return request as Request;
}

it.each(['ar', 'en'] as const)(
  'connects the %s scan to the real POST and displays its accepted receipt',
  async (locale) => {
    const operation = locale === 'ar' ? 'CLOCK_IN' : 'CLOCK_OUT';
    transport.mockResolvedValueOnce(accepted(operation));
    show(locale);
    const input = scan(locale);
    const receipt =
      operation === 'CLOCK_IN' ? 'personalAttendance.clockedIn' : 'personalAttendance.clockedOut';
    expect(await screen.findByText(t(locale, receipt))).not.toBeNull();
    const request = await requestAt();
    expect(new URL(request.url).pathname).toBe('/v1/devices/me/clock-by-card');
    expect(request.method).toBe('POST');
    expect(await request.clone().json()).toEqual({ card_code: 'SYNTHETIC-CARD' });
    expect(request.cache).toBe('no-store');
    expect(request.credentials).toBe('include');
    expect(request.headers.get('Authorization')).toBe('Device synthetic-device-credential');
    expect(request.headers.get('Idempotency-Key')).toMatch(/\S+/);
    expect(input.value).toBe('');
    expect(input.disabled).toBe(false);
    expect(transport).toHaveBeenCalledTimes(1);
  },
);

const rejections = [
  [400, 'pos.cardInvalid'],
  [401, 'pos.cardSignedOut'],
  [403, 'pos.cardForbidden'],
  [429, 'pos.cardLimited'],
] as const;

it.each(
  rejections.flatMap(([status, message]) =>
    (['ar', 'en'] as const).map((locale) => ({ status, message, locale })),
  ),
)('maps HTTP $status to the visible $locale outcome', async ({ status, message, locale }) => {
  transport.mockResolvedValueOnce(Response.json({}, { status }));
  show(locale);
  const input = scan(locale);
  expect(await screen.findByText(t(locale, message))).not.toBeNull();
  expect(input.value).toBe('');
  expect(input.disabled).toBe(status === 401);
  expect(screen.queryByText(t(locale, 'personalAttendance.clockedIn'))).toBeNull();
  if (status === 401) {
    const submit = screen.getByRole('button', {
      name: t(locale, 'pos.cardSubmit'),
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  }
  expect(transport).toHaveBeenCalledTimes(1);
});

it.each(['ar', 'en'] as const)('renders actual Retry-After seconds in %s', async (locale) => {
  transport.mockResolvedValueOnce(
    Response.json({}, { status: 429, headers: { 'Retry-After': '42' } }),
  );
  show(locale);
  scan(locale);
  const seconds = new Intl.NumberFormat(locale, { numberingSystem: 'latn' }).format(42);
  expect(
    await screen.findByText(t(locale, 'pos.cardLimitedFor').replace('{seconds}', seconds)),
  ).not.toBeNull();
  expect(transport).toHaveBeenCalledTimes(1);
});

it('suppresses a second populated scan while the actual transport is pending', async () => {
  const finish = holdRequest();
  show();
  const input = scan();
  await requestAt();
  expect(screen.getByText(t('en', 'personalAttendance.pending'))).not.toBeNull();
  expect(input.value).toBe('');
  expect(input.disabled).toBe(true);
  scan('en', 'SECOND-SYNTHETIC-CARD');
  await act(async () => undefined);
  expect(transport).toHaveBeenCalledTimes(1);
  await finish();
  expect(await screen.findByText(t('en', 'personalAttendance.clockedIn'))).not.toBeNull();
  expect(input.disabled).toBe(false);
  expect(transport).toHaveBeenCalledTimes(1);
});

it('shows network failure and sends another request only after a manual rescan', async () => {
  transport.mockRejectedValueOnce(new TypeError('Synthetic network failure'));
  transport.mockResolvedValueOnce(accepted());
  show();
  const input = scan();
  expect(await screen.findByText(t('en', 'pos.networkError'))).not.toBeNull();
  expect(input.disabled).toBe(false);
  expect(input.value).toBe('');
  fireEvent(window, new Event('online'));
  await act(async () => undefined);
  expect(transport).toHaveBeenCalledTimes(1);
  scan();
  expect(await screen.findByText(t('en', 'personalAttendance.clockedIn'))).not.toBeNull();
  expect(screen.queryByText(t('en', 'pos.networkError'))).toBeNull();
  const first = await requestAt();
  const second = await requestAt(1);
  expect(await second.clone().json()).toEqual({ card_code: 'SYNTHETIC-CARD' });
  expect(second.headers.get('Idempotency-Key')).toMatch(/\S+/);
  expect(second.headers.get('Idempotency-Key')).not.toBe(first.headers.get('Idempotency-Key'));
  expect(transport).toHaveBeenCalledTimes(2);
});

it.each(['unmount', 'offline'] as const)(
  'aborts the real request on %s, ignores late success and never replays a queued scan',
  async (reason) => {
    const finish = holdRequest();
    const view = show();
    const input = scan();
    const request = await requestAt();
    expect(request.signal.aborted).toBe(false);
    expect(input.disabled).toBe(true);
    if (reason === 'unmount') view.unmount();
    else {
      fireEvent(window, new Event('offline'));
      expect(screen.getByText(t('en', 'pos.cardOffline'))).not.toBeNull();
      expect(input.disabled).toBe(true);
      expect(input.value).toBe('');
    }
    await waitFor(() => expect(request.signal.aborted).toBe(true));
    await finish();
    expect(screen.queryByText(t('en', 'personalAttendance.clockedIn'))).toBeNull();
    fireEvent(window, new Event('online'));
    if (reason === 'offline') {
      expect(input.disabled).toBe(false);
      expect(screen.queryByText(t('en', 'pos.cardOffline'))).toBeNull();
      view.unmount();
    }
    show();
    await act(async () => undefined);
    expect((screen.getByLabelText(t('en', 'pos.cardLabel')) as HTMLInputElement).value).toBe('');
    expect(screen.queryByText(t('en', 'personalAttendance.clockedIn'))).toBeNull();
    expect(transport).toHaveBeenCalledTimes(1);
  },
);
