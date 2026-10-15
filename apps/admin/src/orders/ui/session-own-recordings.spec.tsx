import type { ServiceSessionRecoveryPage } from '@pospay/contracts';
import { formatInstant, t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { id, scope } from '../model/session-recording-result.fixture';
import type { ExpiredAttemptView } from '../model/session-recording-result';
import { SessionOwnRecordings } from './session-own-recordings';

const probe = 'redaction-probe-value';
const when = '2026-10-13T08:00:00.000Z';
const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en', get: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

function visit(n: number, customer_name: string) {
  return { id: id(n), occurred_at: when, customer_name, customer_phone_masked: '***001', lines: [{ id: id(n + 20), ordinal: 1, name_ar: 'Marked line', name_en: 'Synthetic service' }] };
}
function page(items: ReturnType<typeof visit>[], cursor: string | null, outcome?: 'COMMITTED' | 'NOT_COMMITTED'): ServiceSessionRecoveryPage {
  return {
    items, next_cursor: cursor,
    attempt: { business_date: '2026-10-13', business_timezone: 'Asia/Kuwait', issued_at: when, expires_at: '2026-10-14T08:00:00.000Z', ...(outcome ? { outcome } : {}) },
  };
}
function refusal(code: string, details?: unknown) {
  return { code, message_ar: 'Synthetic refusal', message_en: 'Refused', ...(details === undefined ? {} : { details }) };
}
function sent(lastSentAt?: number): ExpiredAttemptView {
  return { key: probe, createdAt: Date.parse(when), operation: 'record-service-session', ...(lastSentAt === undefined ? {} : { lastSentAt }) };
}
function open(locale: 'ar' | 'en', attempt: ExpiredAttemptView, onConfirm = vi.fn()) {
  state.locale = locale;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><SessionOwnRecordings scope={scope} attempt={attempt} timeZone="Asia/Kuwait" onConfirm={onConfirm} /></QueryClientProvider>);
  return { ...view, onConfirm };
}
function buttons(locale: 'ar' | 'en') {
  const recorded = screen.getByRole('button', { name: t(locale, 'serviceSessions.recoveryRecorded') }) as HTMLButtonElement;
  const missed = screen.getByRole('button', { name: t(locale, 'serviceSessions.recoveryNotRecorded') }) as HTMLButtonElement;
  return { recorded, missed };
}
function expectChoice(locale: 'ar' | 'en', pressed: 'recorded' | 'missed' | 'none') {
  const { recorded, missed } = buttons(locale);
  expect(recorded.disabled).toBe(false); expect(missed.disabled).toBe(false);
  expect(recorded.getAttribute('aria-pressed')).toBe(pressed === 'recorded' ? 'true' : 'false');
  expect(missed.getAttribute('aria-pressed')).toBe(pressed === 'missed' ? 'true' : 'false');
}

it.each(['ar', 'en'] as const)('shows the attempt time and both enabled buttons before any outcome in %s', async (locale) => {
  state.get.mockReset(); state.get.mockResolvedValue({ data: page([], null) });
  open(locale, sent(Date.parse(when)));
  const attempted = formatInstant(new Date(when), locale, 'Asia/Kuwait');
  expect(await screen.findByText(t(locale, 'serviceSessions.recoveryEmpty'))).toBeTruthy();
  expect(screen.getByText(t(locale, 'serviceSessions.recoveryAttemptAt').replace('{when}', attempted))).toBeTruthy();
  expectChoice(locale, 'none');
  expect(document.body.textContent ?? '').not.toContain(probe);
});

it.each(['ar', 'en'] as const)('lists one visit and several visits in %s', async (locale) => {
  const line = locale === 'ar' ? 'Marked line' : 'Synthetic service';
  state.get.mockReset(); state.get.mockResolvedValueOnce({ data: page([visit(40, 'One customer')], null) });
  const one = open(locale, sent(Date.parse(when)));
  expect(await screen.findByText('One customer')).toBeTruthy();
  expect(screen.getByText(line)).toBeTruthy(); expect(screen.getByText('***001')).toBeTruthy();
  one.unmount();
  state.get.mockResolvedValueOnce({ data: page([visit(41, 'First customer'), visit(42, 'Second customer')], null) });
  open(locale, sent(Date.parse(when)));
  expect(await screen.findByText('First customer')).toBeTruthy();
  expect(screen.getByText('Second customer')).toBeTruthy(); expect(screen.getAllByText(line)).toHaveLength(2);
});

it.each(['ar', 'en'] as const)('loads the next page from the more button in %s', async (locale) => {
  state.get.mockReset();
  let release: ((value: unknown) => void) | undefined;
  state.get.mockResolvedValueOnce({ data: page([visit(43, 'First customer')], 'page-two') }).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  open(locale, sent(Date.parse(when)));
  fireEvent.click(await screen.findByRole('button', { name: t(locale, 'serviceSessions.recoveryMore') }));
  await waitFor(() => expect((screen.getByRole('button', { name: t(locale, 'serviceSessions.recoveryMore') }) as HTMLButtonElement).disabled).toBe(true));
  expectChoice(locale, 'none');
  release?.({ data: page([visit(44, 'Second customer')], null) });
  expect(await screen.findByText('Second customer')).toBeTruthy();
  expect(screen.queryByRole('button', { name: t(locale, 'serviceSessions.recoveryMore') })).toBeNull();
  expect(state.get.mock.calls[1]?.[1].params.query.cursor).toBe('page-two');
});

it.each(['ar', 'en'] as const)('keeps loaded visits when a later page answers CLOSED or NOT_YET in %s', async (locale) => {
  state.get.mockReset();
  state.get.mockResolvedValueOnce({ data: page([visit(45, 'Kept customer')], 'page-two') }).mockResolvedValueOnce({ error: refusal('SESSION_RECOVERY_CLOSED'), response: { status: 409 } });
  const closed = open(locale, sent(Date.parse(when)));
  fireEvent.click(await screen.findByRole('button', { name: t(locale, 'serviceSessions.recoveryMore') }));
  expect(await screen.findByText(t(locale, 'serviceSessions.recoveryWindowEnded'))).toBeTruthy();
  const text = document.body.textContent ?? '';
  expect(text.indexOf('Kept customer')).toBeGreaterThanOrEqual(0);
  expect(text.indexOf('Kept customer')).toBeLessThan(text.indexOf(t(locale, 'serviceSessions.recoveryWindowEnded')));
  closed.unmount();
  state.get.mockResolvedValueOnce({ data: page([visit(46, 'Early customer')], 'page-two') }).mockResolvedValueOnce({ error: refusal('SESSION_RECOVERY_NOT_YET', { opens_at: when }), response: { status: 409 } });
  open(locale, sent(Date.parse(when)));
  fireEvent.click(await screen.findByRole('button', { name: t(locale, 'serviceSessions.recoveryMore') }));
  const opens = formatInstant(new Date(when), locale, 'Asia/Kuwait');
  expect(await screen.findByText(t(locale, 'serviceSessions.recoveryNotYet').replace('{when}', opens))).toBeTruthy();
  expect(screen.getByText('Early customer')).toBeTruthy();
});

it.each(['ar', 'en'] as const)('states the server outcome and pre-selects only that button in %s', async (locale) => {
  state.get.mockReset(); state.get.mockResolvedValueOnce({ data: page([visit(47, 'Saved customer')], null, 'COMMITTED') });
  const saved = open(locale, sent(Date.parse(when)));
  expect(await screen.findByText(t(locale, 'serviceSessions.recoveryCommitted'))).toBeTruthy();
  expect(screen.getByText(t(locale, 'serviceSessions.recoveryCheckFirst'))).toBeTruthy();
  expectChoice(locale, 'recorded'); saved.unmount();
  state.get.mockResolvedValueOnce({ data: page([visit(48, 'Missed customer')], null, 'NOT_COMMITTED') });
  const missed = open(locale, sent(Date.parse(when)));
  expect(await screen.findByText(t(locale, 'serviceSessions.recoveryNotCommitted'))).toBeTruthy();
  expectChoice(locale, 'missed'); missed.unmount();
  state.get.mockResolvedValueOnce({ data: page([visit(49, 'Listed customer')], null) });
  open(locale, sent(Date.parse(when)));
  expect(await screen.findByText('Listed customer')).toBeTruthy();
  expectChoice(locale, 'none');
});

it.each(['ar', 'en'] as const)('explains never reached, cannot verify, not yet and window ended without pre-selecting in %s', async (locale) => {
  const cases = [
    [{ error: refusal('SESSION_RECOVERY_NOT_FOUND'), response: { status: 404 } }, 'serviceSessions.recoveryNeverReached'],
    [{ error: refusal('FORBIDDEN'), response: { status: 403 } }, 'serviceSessions.recoveryCannotVerify'],
    [{ error: refusal('SESSION_RECOVERY_CLOSED'), response: { status: 409 } }, 'serviceSessions.recoveryWindowEnded'],
  ] as const;
  for (const [body, key] of cases) {
    state.get.mockReset(); state.get.mockResolvedValue(body);
    const view = open(locale, sent(Date.parse(when)));
    expect(await screen.findByText(t(locale, key))).toBeTruthy();
    expectChoice(locale, 'none'); view.unmount();
  }
  state.get.mockReset(); state.get.mockResolvedValue({ error: refusal('SESSION_RECOVERY_NOT_YET', { opens_at: when }), response: { status: 409 } });
  const timed = open(locale, sent(Date.parse(when)));
  expect(await screen.findByText(t(locale, 'serviceSessions.recoveryNotYet').replace('{when}', formatInstant(new Date(when), locale, 'Asia/Kuwait')))).toBeTruthy();
  expectChoice(locale, 'none'); timed.unmount();
  state.get.mockClear();
  open(locale, sent());
  expect(screen.getByText(t(locale, 'serviceSessions.recoveryNeverReached'))).toBeTruthy();
  expectChoice(locale, 'none');
  await Promise.resolve();
  expect(state.get).not.toHaveBeenCalled();
});

it.each(['ar', 'en'] as const)('confirms only after she presses a button in %s', async (locale) => {
  state.get.mockReset(); state.get.mockResolvedValue({ data: page([], null) });
  const onConfirm = vi.fn();
  open(locale, sent(Date.parse(when)), onConfirm);
  expect(await screen.findByText(t(locale, 'serviceSessions.recoveryEmpty'))).toBeTruthy();
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.click(buttons(locale).recorded); fireEvent.click(buttons(locale).missed);
  expect(onConfirm.mock.calls).toEqual([['RECORDED_ELSEWHERE'], ['NOT_RECORDED']]);
});
