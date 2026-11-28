import { expect, it } from 'vitest';
import { parseSessionJournalEnvelope } from './session-attempt';
import { id, instant, scope } from './session-recording-result.fixture';

const partial = (occurredAt: string) => ({ version: 1 as const, state: 'PARTIAL' as const, scope, sessionId: id(12), occurredAt });

it('rejects a stored visit time Date.parse accepts when the offset is missing', () => {
  const lenient = '2026-10-12T10:00:00';
  expect(Number.isFinite(Date.parse(lenient))).toBe(true);
  expect(() => parseSessionJournalEnvelope(partial(lenient))).toThrow('SESSION_JOURNAL_TIME_INVALID');
  const parsed = parseSessionJournalEnvelope(partial('2026-10-12T10:00:00.000Z'));
  if (parsed.state !== 'PARTIAL') throw new Error('Expected a partial envelope');
  expect(parsed.occurredAt).toBe('2026-10-12T10:00:00.000Z');
});

it('accepts a PARTIAL envelope with a valid customerId', () => {
  const envelope = { version: 1 as const, state: 'PARTIAL' as const, scope, sessionId: id(12), customerId: id(7) };
  expect(parseSessionJournalEnvelope(envelope)).toEqual(envelope);
});

it('throws SESSION_JOURNAL_CUSTOMER_INVALID when customerId is not a UUID', () => {
  const invalid = { version: 1 as const, state: 'PARTIAL' as const, scope, sessionId: id(12), customerId: 'not-a-uuid' };
  expect(() => parseSessionJournalEnvelope(invalid)).toThrow('SESSION_JOURNAL_CUSTOMER_INVALID');
});

it('rejects customerId on a SAVED_DISPLAY_FAILED envelope', () => {
  const savedDisplay = { version: 1 as const, state: 'SAVED_DISPLAY_FAILED' as const, scope, customerId: id(7) };
  expect(() => parseSessionJournalEnvelope(savedDisplay)).toThrow('SESSION_JOURNAL_INVALID');
});

const expiredVisit = { version: 1 as const, state: 'EXPIRED' as const, scope, key: id(20), createdAt: Date.parse(instant), sessionId: id(12), customerId: id(7), occurredAt: instant };
const withoutSessionId = { version: 1 as const, state: 'EXPIRED' as const, scope, key: id(20), createdAt: Date.parse(instant), customerId: id(7), occurredAt: instant };

it.each([
  ['valid', expiredVisit, null],
  ['without sessionId', withoutSessionId, 'SESSION_JOURNAL_INVALID'],
  ['invalid customerId', { ...expiredVisit, customerId: 'not-a-uuid' }, 'SESSION_JOURNAL_CUSTOMER_INVALID'],
])('validates EXPIRED envelope with visit metadata (%s)', (_case, envelope, error) => {
  if (error) expect(() => parseSessionJournalEnvelope(envelope)).toThrow(error);
  else expect(parseSessionJournalEnvelope(envelope)).toEqual(envelope);
});

it('strips unknown top-level envelope keys while unknown scope keys still throw', () => {
  const envelope = { version: 1 as const, state: 'PARTIAL' as const, scope, sessionId: id(12) };
  expect(parseSessionJournalEnvelope({ ...envelope, futureField: 'x' })).toEqual(envelope);
  expect(() => parseSessionJournalEnvelope({ ...envelope, scope: { ...scope, extra: 'y' } })).toThrow('SESSION_JOURNAL_INVALID');
});

it.each([
  'phone', 'customerPhone', 'Email', 'otp', 'customerName', 'CustomerName',
  'verificationCode', 'vErIfIcAtIoNcOdE', 'customerphone', 'cUsToMeRpHoNe', 'customerPin',
] as const)('PII-shaped unknown key %s on PARTIAL envelope throws SESSION_JOURNAL_INVALID', (key) => {
  const envelope = { version: 1 as const, state: 'PARTIAL' as const, scope, sessionId: id(12) };
  expect(() => parseSessionJournalEnvelope({ ...envelope, [key]: 'secret' })).toThrow('SESSION_JOURNAL_INVALID');
});

it.each(['errorCode', 'displayName', 'filename'] as const)('drops unknown harmless key %s from PARTIAL envelope', (key) => {
  const envelope = { version: 1 as const, state: 'PARTIAL' as const, scope, sessionId: id(12) };
  expect(parseSessionJournalEnvelope({ ...envelope, [key]: 'x' })).toEqual(envelope);
});

it('handles deeply nested and wide neutral extensions without overflow and still rejects deeply nested PII', () => {
  const envelope = { version: 1 as const, state: 'PARTIAL' as const, scope, sessionId: id(12) };
  let neutral: Record<string, unknown> = { leaf: 'ok' };
  let pii: Record<string, unknown> = { customerPhone: 'secret' };
  for (let depth = 0; depth < 2000; depth += 1) {
    neutral = { nested: neutral };
    pii = { nested: pii };
  }
  const wide = Array.from({ length: 150_000 }, () => 'ok');
  expect(parseSessionJournalEnvelope({ ...envelope, futureMeta: neutral })).toEqual(envelope);
  expect(parseSessionJournalEnvelope({ ...envelope, wide })).toEqual(envelope);
  expect(() => parseSessionJournalEnvelope({ ...envelope, futureMeta: pii })).toThrow('SESSION_JOURNAL_INVALID');
});
