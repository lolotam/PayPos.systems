import { expect, it } from 'vitest';
import { sessionServiceOption, sessionServiceOptionPage, sessionServiceOptionsQuery,
  sessionPerformerOptionsQuery, sessionPerformerOptionPage, sessionPerformerCursorData } from './service-session-options.js';
import { serviceSessionFormPaths } from './service-session-form-openapi.js';

const id = '00000000-0000-7000-8000-000000000001';
const option = { id, name_ar: null, name_en: 'Synthetic service', price: '7.125', revision: 2 };
it('documents dated performer search and stable cursor bounds under recording authority', () => {
  const route = serviceSessionFormPaths['/v1/businesses/{businessId}/branches/{branchId}/service-sessions/performer-options'].get;
  expect(route.description).toContain('record:service-sessions:branch');
  expect(route.parameters.find((p) => p.name === 'occurred_at')?.required).toBe(true);
  expect(route.parameters.find((p) => p.name === 'lang')).toMatchObject({ required: true, schema: { type: 'string', enum: ['ar', 'en'] } });
  expect(route.parameters.find((p) => p.name === 'cursor')?.schema).not.toHaveProperty('format');
  expect(route.parameters.find((p) => p.name === 'q')?.schema).toEqual({ type: 'string', minLength: 1, maxLength: 50 });
  expect(route.responses['200'].content['application/json'].schema.$ref).toBe('#/components/schemas/SessionPerformerOptionPage');
});
it('requires strict cursor language, search/scope hashes and requested/effective instants without carrying search text', () => {
  const payload = { key: 'Displayed name', id, lang: 'ar', q_hash: 'a'.repeat(64),
    requested_at: '2026-10-14T08:00:00.000Z', effective_at: '2026-10-14T08:00:00.000Z', scope_hash: 'b'.repeat(64) };
  expect(sessionPerformerCursorData.parse(payload)).toEqual(payload);
  for (const change of [{ lang: undefined }, { lang: 'fr' }, { q_hash: undefined }, { q_hash: 'bad' }, { q: 'private search' },
    { requested_at: undefined }, { effective_at: undefined }, { requested_at: 'bad' }, { effective_at: '2026-10-14' }, { working_date: '2026-10-14' },
    { scope_hash: undefined }, { scope_hash: 'bad' }])
    expect(sessionPerformerCursorData.safeParse({ ...payload, ...change }).success).toBe(false);
});
it('requires occurred time, trims bounded search and rejects private performer fields', () => {
  const occurred_at = '2026-10-14T08:00:00Z';
  expect(sessionPerformerOptionsQuery.parse({ occurred_at, lang: 'ar', q: '  سارة  ' })).toEqual({ occurred_at, lang: 'ar', q: 'سارة', limit: 20 });
  expect(sessionPerformerOptionsQuery.parse({ occurred_at, lang: 'en', limit: '100' }).limit).toBe(100);
  for (const query of [{}, { occurred_at: 'bad', lang: 'en' }, { occurred_at, lang: 'en', q: '' }, { occurred_at, lang: 'en', q: ' ' },
    { occurred_at, lang: 'en', q: 'a'.repeat(51) }, { occurred_at, lang: 'en', limit: 101 }, { occurred_at, lang: 'en', cursor: 'bad=' },
    { occurred_at, lang: 'en', user_id: id }, { occurred_at }, { occurred_at, lang: 'AR' },
    { occurred_at, lang: 'en', q: '\u0000' }, { occurred_at, lang: 'en', q: 'élè\u0000' }])
    expect(sessionPerformerOptionsQuery.safeParse(query).success).toBe(false);
  const item = { id, name_ar: null, name_en: 'Synthetic employee', employee_number: 7, not_clocked_in_warning: true, approved_leave_warning: false };
  expect(sessionPerformerOptionPage.parse({ items: [item], next_cursor: null }).items).toEqual([item]);
  expect(sessionPerformerOptionPage.safeParse({ items: [{ ...item, employee_number: null }], next_cursor: null }).success).toBe(false);
  expect(sessionPerformerOptionPage.safeParse({ items: [{ ...item, employee_number: 0 }], next_cursor: null }).success).toBe(false);
  expect(sessionPerformerOptionPage.safeParse({ items: [{ ...item, employee_number: 1_000_000 }], next_cursor: null }).success).toBe(false);
  for (const field of ['salary', 'phone', 'leave_reason', 'attendance_history', 'user_id']) {
    const parsed = sessionPerformerOptionPage.parse({ items: [{ ...item, [field]: 'private' }], next_cursor: null });
    expect(parsed.items).toEqual([item]);
    expect(parsed.items[0]).not.toHaveProperty(field);
  }
});
it('documents the guarded limited GET, language/search cursor, page bounds and response schema', () => {
  const route = serviceSessionFormPaths['/v1/businesses/{businessId}/branches/{branchId}/service-sessions/service-options'].get;
  expect(route.description).toContain('record:service-sessions:branch');
  expect(route.parameters.find((p) => p.name === 'limit')?.schema).toEqual({ type: 'integer', minimum: 1, maximum: 100, default: 20 });
  expect(route.parameters.map((p) => p.name)).toEqual(['x-company-id', 'businessId', 'branchId', 'lang', 'q', 'cursor', 'limit']);
  expect(route.parameters.find((p) => p.name === 'lang')?.required).toBe(true);
  expect(route.parameters.find((p) => p.name === 'cursor')?.schema).not.toHaveProperty('format');
  expect(route.responses['200'].content['application/json'].schema.$ref).toBe('#/components/schemas/SessionServiceOptionPage');
});
it('requires language and validates trimmed literal search and opaque cursor bounds', () => {
  expect(sessionServiceOptionsQuery.parse({ lang: 'ar' })).toEqual({ lang: 'ar', limit: 20 });
  expect(sessionServiceOptionsQuery.parse({ lang: 'en', q: ' É ', cursor: 'YWJj', limit: '100' })).toEqual({ lang: 'en', q: 'É', cursor: 'YWJj', limit: 100 });
  expect(sessionServiceOptionsQuery.safeParse({}).success).toBe(false);
  for (const query of [{ lang: 'fr' }, { cursor: 'bad=' }, { q: '' }, { q: ' ' }, { q: 'a'.repeat(51) }, { q: '\u0000' },
    { limit: '0' }, { limit: '101' }, { limit: '1.5' }, { business_id: id }])
    expect(sessionServiceOptionsQuery.safeParse({ lang: 'en', ...query }).success).toBe(false);
});
it('keeps exact canonical prices, drops unknown fields and rejects malformed pages', () => {
  for (const price of ['0.000', '7.125', '99999999999.999'])
    expect(sessionServiceOption.parse({ ...option, price }).price).toBe(price);
  for (const fields of [{ price: 7.125 }, { price: '7.12' }, { price: '-1.000' }, { revision: 0 }])
    expect(sessionServiceOption.safeParse({ ...option, ...fields }).success).toBe(false);
  for (const fields of [{ commission_rule: { kind: 'ZERO' } }, { counts_toward_threshold: true }, { business_id: id }])
    expect(sessionServiceOption.parse({ ...option, ...fields })).toEqual(option);
  expect(sessionServiceOptionPage.parse({ items: [option], next_cursor: null })).toEqual({ items: [option], next_cursor: null });
  expect(sessionServiceOptionPage.safeParse({ items: [], next_cursor: 'bad=' }).success).toBe(false);
  expect(sessionServiceOptionPage.parse({ items: [], next_cursor: null, total: 0 })).toEqual({ items: [], next_cursor: null });
});
