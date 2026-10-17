import { expect, it } from 'vitest';
import {
  recordSessionTipsInput,
  sessionTipEntry,
  sessionTips,
  sessionTipsChanged,
} from './session-tips.js';

const employee = '01920000-0000-7000-8000-000000004001';
const other = '01920000-0000-7000-8000-000000004002';
const entry = { employee_id: employee, method: 'CARD' as const, amount: '6.000' };
const body = { expected_revision: 0, tips: [entry] };

function tipId(index: number): string {
  return `01920000-0000-7000-8000-${String(index).padStart(12, '0')}`;
}

it('accepts the first entry at revision 0 without a reason', () => {
  expect(recordSessionTipsInput.parse(body)).toEqual(body);
});

it('accepts expected revision 0 and rejects a negative or fractional one', () => {
  expect(recordSessionTipsInput.safeParse(body).success).toBe(true);
  expect(recordSessionTipsInput.safeParse({ ...body, expected_revision: -1 }).success).toBe(false);
  expect(recordSessionTipsInput.safeParse({ ...body, expected_revision: 1.5 }).success).toBe(false);
});

it.each(['-1.000', '1.00', '01.000', '100000000000.000', '1e3', '6'])(
  'rejects noncanonical money %s',
  (amount) => {
    expect(sessionTipEntry.safeParse({ ...entry, amount }).success).toBe(false);
    expect(
      recordSessionTipsInput.safeParse({ ...body, tips: [{ ...entry, amount }] }).success,
    ).toBe(false);
    expect(
      sessionTips.safeParse({
        revision: 1,
        tips: [{ ...entry, amount }],
        total_cash: '0.000',
        total_card: amount,
      }).success,
    ).toBe(false);
  },
);

it.each([{ extra: true }, { customer_id: employee }, { phone: '50000000' }])(
  'rejects unknown keys on the strict body %#',
  (extra) => {
    expect(recordSessionTipsInput.safeParse({ ...body, ...extra }).success).toBe(false);
  },
);

it('rejects an unknown key on a tip entry', () => {
  expect(
    recordSessionTipsInput.safeParse({ ...body, tips: [{ ...entry, name: 'Sara' }] }).success,
  ).toBe(false);
});

it('lets an over-long reason through so the domain answers 422', () => {
  const reason = 'ا'.repeat(600);
  expect(recordSessionTipsInput.parse({ ...body, reason }).reason).toBe(reason);
});

it('accepts an empty tip list and lowercases the recorder membership', () => {
  const parsed = recordSessionTipsInput.parse({
    expected_revision: 0,
    tips: [],
    recorder_membership_id: '01920000-ABCD-7000-8000-000000004001',
  });
  expect(parsed.tips).toEqual([]);
  expect(parsed.recorder_membership_id).toBe('01920000-abcd-7000-8000-000000004001');
  expect(parsed).not.toHaveProperty('reason');
});

it('accepts 64 entries and rejects a 65th or a method outside cash and card', () => {
  const tips = Array.from({ length: 65 }, (_, index) => ({
    employee_id: tipId(index + 1),
    method: 'CASH' as const,
    amount: '1.000',
  }));
  expect(
    recordSessionTipsInput.safeParse({ expected_revision: 0, tips: tips.slice(0, 64) }).success,
  ).toBe(true);
  expect(recordSessionTipsInput.safeParse({ expected_revision: 0, tips }).success).toBe(false);
  expect(sessionTipEntry.safeParse({ ...entry, method: 'WALLET' }).success).toBe(false);
});

it('reads a visit with no tips yet as revision 0 and zero totals', () => {
  const none = { revision: 0, tips: [], total_cash: '0.000', total_card: '0.000' };
  expect(sessionTips.parse(none)).toEqual(none);
  expect(sessionTips.safeParse({ ...none, customer_id: employee }).success).toBe(false);
});

it('rejects a reason, a phone and a customer on the tip event', () => {
  const event = {
    session_id: employee,
    business_id: other,
    branch_id: employee,
    occurred_at: '2026-10-17T12:00:00.000Z',
    business_date: '2026-10-17',
    revision: 1,
    changed_at: '2026-10-17T12:05:00.000Z',
    tips: [entry, { employee_id: other, method: 'CASH' as const, amount: '2.000' }],
    schema_version: 1 as const,
  };
  expect(sessionTipsChanged.parse(event)).toEqual(event);
  expect(sessionTipsChanged.safeParse({ ...event, reason: 'تعديل' }).success).toBe(false);
  expect(sessionTipsChanged.safeParse({ ...event, customer_id: employee }).success).toBe(false);
  expect(sessionTipsChanged.safeParse({ ...event, phone: '50000000' }).success).toBe(false);
});
