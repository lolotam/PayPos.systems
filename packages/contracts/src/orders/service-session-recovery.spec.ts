import { expect, it } from 'vitest';
import { confirmSessionRecoveryBody, serviceSessionRecoveryPage, serviceSessionRecoveryQuery } from './service-session-recovery.js';

const id = '00000000-0000-7000-8000-000000000001';
const visit = {
  id, occurred_at: '2026-10-14T08:00:00.000Z', customer_name: 'Synthetic customer', customer_phone_masked: '***123',
  lines: [{ id, ordinal: 1, name_ar: null, name_en: 'Synthetic service' }],
};
const attempt = {
  business_date: '2026-10-14', business_timezone: 'Asia/Kuwait',
  issued_at: '2026-10-15T08:00:00.000Z', expires_at: '2026-10-18T08:00:00.000Z',
};

it('accepts the recovery query and rejects a cursor or operation outside the contract', () => {
  expect(serviceSessionRecoveryQuery.parse({ operation: 'record-service-session' }).operation).toBe('record-service-session');
  expect(serviceSessionRecoveryQuery.parse({ operation: 'append-service-session-lines', cursor: 'abc_DEF-09' }).cursor).toBe('abc_DEF-09');
  for (const bad of [{}, { operation: 'other' }, { operation: 'record-service-session', cursor: '*' },
    { operation: 'record-service-session', limit: 50 }]) {
    expect(serviceSessionRecoveryQuery.safeParse(bad).success).toBe(false);
  }
});

it('parses an open page with or without outcome and rejects a hidden null', () => {
  expect(serviceSessionRecoveryPage.parse({ items: [], next_cursor: null, attempt }).attempt.outcome).toBeUndefined();
  expect(serviceSessionRecoveryPage.parse({ items: [visit], next_cursor: null, attempt: { ...attempt, outcome: 'COMMITTED' } }).items).toHaveLength(1);
  expect(serviceSessionRecoveryPage.parse({ items: [visit], next_cursor: null, attempt: { ...attempt, outcome: 'NOT_COMMITTED' } }).attempt.outcome).toBe('NOT_COMMITTED');
  expect(serviceSessionRecoveryPage.safeParse({ items: [], next_cursor: null, attempt: { ...attempt, outcome: null } }).success).toBe(false);
  expect(serviceSessionRecoveryPage.safeParse({ items: [], next_cursor: null, attempt, key: 'secret' }).success).toBe(false);
});

it('accepts only the two confirm outcomes', () => {
  expect(confirmSessionRecoveryBody.parse({ operation: 'record-service-session', outcome: 'NOT_RECORDED' }).outcome).toBe('NOT_RECORDED');
  expect(confirmSessionRecoveryBody.safeParse({ operation: 'record-service-session', outcome: 'COMMITTED' }).success).toBe(false);
  expect(confirmSessionRecoveryBody.safeParse({ operation: 'record-service-session', outcome: 'RECORDED_ELSEWHERE', key: 'secret' }).success).toBe(false);
});
