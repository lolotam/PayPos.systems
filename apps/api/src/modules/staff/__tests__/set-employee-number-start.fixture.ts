import { expect } from 'vitest';
import { employeeNumberIds, readCounter, type EmployeeFixture } from './employee-number-assign.fixture.ts';
import { clearNumberGrants, grantNumber, numberFixture } from './set-employee-number.fixture.ts';

export { clearNumberGrants, grantNumber, numberFixture, readCounter, employeeNumberIds, type EmployeeFixture };

export const ALREADY_SET = {
  code: 'EMPLOYEE_NUMBER_START_ALREADY_SET',
  message_en: 'The starting number was already chosen once and cannot be changed.',
  message_ar: 'رقم بداية الترقيم حُدّد مرة واحدة ولا يمكن تغييره.',
};

export async function putStart(
  fixture: EmployeeFixture,
  body: object,
  options: { cookie?: string; company?: string } = {},
) {
  const response = await fixture.h.app.inject({
    method: 'PUT',
    url: '/v1/employee-numbering/start',
    headers: {
      cookie: options.cookie ?? fixture.cookie,
      'x-company-id': options.company ?? fixture.company,
      origin: 'http://admin.test',
    },
    payload: body,
  });
  return { status: response.statusCode, body: response.json<Record<string, unknown>>() };
}

export function getNumbering(fixture: EmployeeFixture, options: { cookie?: string; company?: string } = {}) {
  return fixture.h.send('GET', '/v1/employee-numbering', {
    cookie: options.cookie ?? fixture.cookie,
    company: options.company ?? fixture.company,
  });
}

export async function devicePut(fixture: EmployeeFixture, token: string, body: object) {
  const response = await fixture.h.app.inject({
    method: 'PUT',
    url: '/v1/employee-numbering/start',
    payload: body,
    headers: { authorization: `Device ${token}`, 'x-company-id': fixture.company, origin: 'http://admin.test' },
  });
  return { status: response.statusCode, body: response.json<Record<string, unknown>>() };
}

export async function withoutStaff(fixture: EmployeeFixture, work: () => Promise<void>) {
  await fixture.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES (${fixture.company},'staff',false,'Synthetic disabled',${fixture.userId})`;
  try {
    await work();
  } finally {
    await fixture.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${fixture.company} AND flag='staff'`;
  }
}

export async function expectOwnerAudit(fixture: EmployeeFixture, companyId: string, body: Record<string, unknown>) {
  const setAt = Date.parse(String(body['start_set_at']));
  expect(Math.abs(Date.now() - setAt)).toBeLessThan(60_000);
  const [owner] = await fixture.h.owner`SELECT id FROM "user" WHERE email='employee-owner@example.test'`;
  const row = await counterOf(fixture, companyId);
  expect(row).toMatchObject({
    next_number: 40,
    start_number: 40,
    start_set_by: owner?.['id'],
    start_set_at: body['start_set_at'],
  });
  const again = await getNumbering(fixture, { cookie: fixture.ownerCookie, company: companyId });
  expect(again.body).toEqual(body);
}

function storedInstant(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

export async function counterOf(fixture: EmployeeFixture, companyId: string) {
  const [row] = await fixture.h.owner<Record<string, unknown>[]>`
    SELECT next_number, start_number, start_set_by, start_set_at
    FROM employee_number_sequences WHERE company_id=${companyId}`;
  if (row === undefined) return null;
  return {
    next_number: Number(row['next_number']),
    start_number: row['start_number'] === null ? null : Number(row['start_number']),
    start_set_by: row['start_set_by'],
    start_set_at: storedInstant(row['start_set_at']),
  };
}

export function startAudits(fixture: EmployeeFixture, companyId: string) {
  return fixture.h.owner<{ entity_id: string; actor_user_id: string; before: unknown; after: unknown }[]>`
    SELECT entity_id, actor_user_id, before, after FROM audit_log
    WHERE company_id=${companyId} AND entity='employee_number_sequences' AND action='employee_number.start_set'`;
}

export async function numbersOf(fixture: EmployeeFixture, companyId: string) {
  const rows = await fixture.h.owner<{ employee_number: number | string }[]>`
    SELECT employee_number FROM employees WHERE company_id=${companyId} ORDER BY employee_number`;
  return rows.map((row) => Number(row.employee_number));
}
