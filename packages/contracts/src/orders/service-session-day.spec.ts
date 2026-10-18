import { expect, it } from 'vitest';
import { serviceSessionDayQuery, serviceSessionDayPage, serviceSessionDayCursor } from './service-session-day.js';

it('requires a real calendar date, bounds pagination and accepts only the late literal', () => {
  expect(serviceSessionDayQuery.parse({ date: '2024-02-29' })).toEqual({ date: '2024-02-29', limit: 20 });
  expect(serviceSessionDayQuery.parse({ date: '2026-10-14', late: 'true', limit: '100' }).limit).toBe(100);
  for (const bad of [{}, { date: '0000-01-01' }, { date: '2026-02-29' }, { date: '2026-04-31' }, { date: '2026-10-14', late: 'false' },
    { date: '2026-10-14', limit: 0 }, { date: '2026-10-14', limit: 101 }, { date: '2026-10-14', cursor: '*' },
    { date: '2026-10-14', employee_id: 'client-filter' }]) expect(serviceSessionDayQuery.safeParse(bad).success).toBe(false);
});
it('allows an empty page and drops an unknown key', () => {
  expect(serviceSessionDayPage.parse({ items: [], next_cursor: null })).toEqual({ items: [], next_cursor: null });
  expect(serviceSessionDayPage.parse({ items: [], next_cursor: null, phone: 'private' })).toEqual({
    items: [],
    next_cursor: null,
  });
});

it('bounds cursor timestamps to real UTC dates in PostgreSQL range with microsecond precision', () => {
  const id = '00000000-0000-7000-8000-000000000001';
  const cursor = { v: 1, company: id, business: id, branch: id, date: '2026-10-14', late: false, id };
  for (const at of ['0001-01-01T00:00:00.000000Z', '2024-02-29T12:30:00.123456Z', '9999-12-31T23:59:59.999999Z']) {
    expect(serviceSessionDayCursor.safeParse({ ...cursor, at }).success).toBe(true);
  }
  for (const at of ['0000-01-01T00:00:00.000000Z', '-000001-01-01T00:00:00.000000Z',
    '+300000-01-01T00:00:00.000000Z', '10000-01-01T00:00:00.000000Z', '2026-02-29T00:00:00.000000Z',
    '2026-10-14T24:00:00.000000Z', '2026-10-14T23:59:60.000000Z', 'infinity', '-infinity',
    '2026-10-14T08:00:00.123Z', '0001-01-01T00:00:00.000000+03:00']) {
    expect(serviceSessionDayCursor.safeParse({ ...cursor, at }).success).toBe(false);
  }
});
