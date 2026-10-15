import type { ServiceSessionRecoveryPage } from '@pospay/contracts';
import { expect, it } from 'vitest';
import { recoveryPanelFromRead, suggestedRecoveryConfirmation } from './session-recovery-state';
import { id } from './session-recording-result.fixture';

const when = '2026-10-13T08:00:00.000Z';
function page(names: string[], cursor: string | null, outcome?: 'COMMITTED' | 'NOT_COMMITTED', start = 30): ServiceSessionRecoveryPage {
  return {
    items: names.map((customer_name, index) => ({
      id: id(start + index), occurred_at: when, customer_name, customer_phone_masked: '***001',
      lines: [{ id: id(start + 20 + index), ordinal: 1, name_ar: 'خدمة', name_en: 'Synthetic service' }],
    })),
    next_cursor: cursor,
    attempt: { business_date: '2026-10-13', business_timezone: 'Asia/Kuwait', issued_at: when, expires_at: '2026-10-14T08:00:00.000Z', ...(outcome ? { outcome } : {}) },
  };
}
function refusal(code: string, details?: unknown) {
  return { code, message_ar: 'رفض', message_en: 'Refused', ...(details === undefined ? {} : { details }) };
}
function read(pages: ServiceSessionRecoveryPage[], error: unknown, morePageFailed = false, lastSentAt: number | null = 1) {
  return recoveryPanelFromRead({ lastSentAt: lastSentAt === null ? undefined : lastSentAt, pages, error, morePageFailed });
}

it('pre-selects the recorded button for COMMITTED and the missed button for NOT_COMMITTED', () => {
  expect(suggestedRecoveryConfirmation(read([page(['Kept'], null, 'COMMITTED')], null))).toBe('RECORDED_ELSEWHERE');
  expect(suggestedRecoveryConfirmation(read([page(['Kept'], null, 'NOT_COMMITTED')], null))).toBe('NOT_RECORDED');
});

it('pre-selects nothing when the outcome is absent or the panel is not a list', () => {
  const listed = read([page(['Kept'], null)], null);
  expect(suggestedRecoveryConfirmation(listed)).toBeNull();
  expect(listed && listed.kind === 'LIST' && 'outcome' in listed).toBe(false);
  expect(suggestedRecoveryConfirmation(read([], refusal('SESSION_RECOVERY_CLOSED')))).toBeNull();
  expect(suggestedRecoveryConfirmation(null)).toBeNull();
});

it('does not read a panel from pages when the attempt was never sent', () => {
  expect(read([page(['Kept'], null, 'COMMITTED')], null, false, null)).toEqual({ kind: 'NEVER_REACHED' });
  expect(read([], null, false, null)).toEqual({ kind: 'NEVER_REACHED' });
});

it('stays empty while the first page is still in flight', () => {
  expect(read([], null)).toBeNull();
});

it('maps a missing proof to NEVER_REACHED and a closed proof to WINDOW_ENDED', () => {
  expect(read([], refusal('SESSION_RECOVERY_NOT_FOUND'))).toEqual({ kind: 'NEVER_REACHED' });
  expect(read([], refusal('SESSION_RECOVERY_CLOSED'))).toEqual({ kind: 'WINDOW_ENDED' });
});

it('maps NOT_YET to the opening time and FORBIDDEN to CANNOT_VERIFY', () => {
  expect(read([], refusal('SESSION_RECOVERY_NOT_YET', { opens_at: when }))).toEqual({ kind: 'NOT_YET', opensAt: when });
  expect(read([], refusal('SESSION_RECOVERY_NOT_YET'))).toEqual({ kind: 'NOT_YET', opensAt: null });
  expect(read([], refusal('FORBIDDEN'))).toEqual({ kind: 'CANNOT_VERIFY' });
});

it('maps an unreadable failure to CANNOT_VERIFY without claiming the attempt is missing', () => {
  expect(read([], new Error('offline'))).toEqual({ kind: 'CANNOT_VERIFY' });
  expect(read([], { code: 'SESSION_RECOVERY_NOT_FOUND' })).toEqual({ kind: 'CANNOT_VERIFY' });
});

it('lists an empty page, one page and the next page without hiding a missing outcome', () => {
  expect(read([page([], null)], null)).toMatchObject({ kind: 'LIST', visits: [], nextCursor: null, businessDate: '2026-10-13', businessTimezone: 'Asia/Kuwait' });
  const joined = read([page(['First'], 'page-two', 'NOT_COMMITTED'), page(['Second'], null, undefined, 32)], null);
  expect(joined && joined.kind === 'LIST' && joined.visits.map((visit) => visit.customer_name)).toEqual(['First', 'Second']);
  expect(joined).toMatchObject({ nextCursor: null, outcome: 'NOT_COMMITTED' });
});

it('keeps loaded visits when a later page answers CLOSED or NOT_YET', () => {
  const closed = read([page(['Kept'], 'page-two', 'COMMITTED')], refusal('SESSION_RECOVERY_CLOSED'), true);
  expect(closed).toMatchObject({ kind: 'LIST', nextCursor: null, notice: 'WINDOW_ENDED', outcome: 'COMMITTED' });
  expect(closed && closed.kind === 'LIST' && closed.visits.map((visit) => visit.customer_name)).toEqual(['Kept']);
  const early = read([page(['Kept'], 'page-two')], refusal('SESSION_RECOVERY_NOT_YET', { opens_at: when }), true);
  expect(early).toMatchObject({ kind: 'LIST', nextCursor: null, notice: 'NOT_YET', opensAt: when });
  expect(early && early.kind === 'LIST' && 'outcome' in early).toBe(false);
});

it('keeps the list and its cursor when a later page fails for another reason', () => {
  const panel = read([page(['Kept'], 'page-two')], refusal('FORBIDDEN'), true);
  expect(panel).toMatchObject({ kind: 'LIST', nextCursor: 'page-two' });
  expect(panel && panel.kind === 'LIST' && panel.notice).toBeUndefined();
});
