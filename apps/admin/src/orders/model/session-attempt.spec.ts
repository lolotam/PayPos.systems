import { expect, it } from 'vitest';
import { parseSessionJournalEnvelope } from './session-attempt';
import { id, scope } from './session-recording-result.fixture';

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
