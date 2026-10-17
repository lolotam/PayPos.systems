import { sessionTips, sessionTipsChanged } from '@pospay/contracts';
import { expect, it } from 'vitest';
import { sessionTipsAudit, sessionTipsChangedEvent, tipSetResponse } from '../tip-records.ts';
import type { TipEntry } from '../tip-set.ts';

const sara = '01990000-0000-7000-8000-00000000000b';
const hiba = '01990000-0000-7000-8000-00000000000c';
const session = {
  id: '01990000-0000-7000-8000-0000000000aa',
  business_id: '01990000-0000-7000-8000-0000000000bb',
  branch_id: '01990000-0000-7000-8000-0000000000cc',
  occurred_at: new Date('2026-10-17T09:30:00.000Z'),
  business_date: '2026-10-17',
  business_timezone: 'Asia/Kuwait',
};
const changedAt = new Date('2026-10-17T09:31:00.000Z');

function entry(employee_id: string, method: TipEntry['method'], amount: bigint): TipEntry {
  return { employee_id, method, amount };
}

const scrambled = [
  entry(hiba, 'CASH', 2000n),
  entry(sara, 'CASH', 1000n),
  entry(sara, 'CARD', 6000n),
];

const ordered = [
  { employee_id: sara, method: 'CARD' as const, amount: '6.000' },
  { employee_id: sara, method: 'CASH' as const, amount: '1.000' },
  { employee_id: hiba, method: 'CASH' as const, amount: '2.000' },
];

function keysOf(value: unknown): string[] {
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...keysOf(child)]);
}

it('builds the response in employee then method order with canonical totals', () => {
  const response = tipSetResponse(2, scrambled);
  expect(sessionTips.parse(response)).toEqual(response);
  expect(response.tips).toEqual(ordered);
  expect(response.total_cash).toBe('3.000');
  expect(response.total_card).toBe('6.000');
  expect(scrambled.map((item) => item.employee_id)).toEqual([hiba, sara, sara]);
});

it('builds an empty revision as zero canonical totals', () => {
  expect(tipSetResponse(0, [])).toEqual({
    revision: 0,
    tips: [],
    total_cash: '0.000',
    total_card: '0.000',
  });
});

it('builds the event from the session clock and the full sorted set', () => {
  const payload = sessionTipsChangedEvent(session, 2, changedAt, scrambled);
  expect(sessionTipsChanged.parse(payload)).toEqual(payload);
  expect(payload.occurred_at).toBe('2026-10-17T09:30:00.000Z');
  expect(payload.changed_at).toBe('2026-10-17T09:31:00.000Z');
  expect(payload.tips).toEqual(ordered);
  expect(payload.schema_version).toBe(1);
  expect(payload).not.toHaveProperty('business_timezone');
});

it('records the first revision and replaces every later one without a reason', () => {
  const recorded = sessionTipsAudit(session.id, { revision: 0, entries: scrambled }, {
    revision: 1,
    entries: scrambled,
  });
  expect(recorded.entityId).toBe(session.id);
  expect(recorded.action).toBe('tips.recorded');
  expect(recorded.before).toBeNull();
  expect(recorded.after.entries).toEqual(ordered);
  const replaced = sessionTipsAudit(
    session.id,
    { revision: 1, entries: [entry(sara, 'CARD', 6000n)] },
    { revision: 2, entries: [] },
  );
  expect(replaced).toEqual({
    entity: 'service_session_tips',
    entityId: session.id,
    action: 'tips.replaced',
    before: { revision: 1, entries: [{ employee_id: sara, method: 'CARD', amount: '6.000' }] },
    after: { revision: 2, entries: [] },
  });
  expect(
    sessionTipsAudit(session.id, null, { revision: 1, entries: [] }).before,
  ).toBeNull();
});

it('keeps reason, phone and customer out of the response, the event and the audit', () => {
  const response = tipSetResponse(1, scrambled);
  const payload = sessionTipsChangedEvent(session, 1, changedAt, scrambled);
  const audit = sessionTipsAudit(session.id, null, { revision: 1, entries: scrambled });
  const names = keysOf({ response, payload, audit });
  expect(names).not.toContain('reason');
  expect(names).not.toContain('phone');
  expect(names).not.toContain('customer');
  expect(names).not.toContain('customer_id');
  expect(JSON.stringify({ response, payload, audit })).not.toMatch(/reason|phone|customer/i);
});
