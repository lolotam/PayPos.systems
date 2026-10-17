import { afterAll, beforeAll, expect, it } from 'vitest';
import { monthlyReportFixture, reportHeaders, reportUrl, reportSession, type MonthlyReportFixture } from './attendance-monthly-report.fixture.ts';

let f: MonthlyReportFixture;
beforeAll(async () => { f = await monthlyReportFixture(); await reportSession(f); });
afterAll(async () => { await f?.db.close(); await f?.h.close(); });
const get = (branch = f.branch, csv = true) => f.h.app.inject({method:'GET',url:reportUrl(f,branch,csv),headers:reportHeaders(f)});

it('AB-Q9d/e/f returns UTF-8 BOM, Arabic RFC 4180 CSV with h:mm, decimals and the employee number first; no private fields', async () => {
  await f.h.owner`UPDATE employees SET name_en='Synthetic, "quoted"'||chr(10)||'employee' WHERE company_id=${f.company} AND id=${f.employee.id}`;
  const response = await get();
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
  expect(response.rawPayload.subarray(0,3)).toEqual(Buffer.from([0xef,0xbb,0xbf]));
  expect(response.payload.replace(/^\uFEFF/, '').startsWith('"رقم الموظف",')).toBe(true);
  expect(response.payload).toContain('اسم الموظفة');
  expect(response.payload).toContain('"Synthetic, ""quoted""\nemployee"');
  expect(response.payload).toContain('"8:00","8.00"');
  expect(response.payload).toContain('"-220:00","-220.00"');
  expect(response.payload).not.toMatch(/phone|salary|iban|employee_id|تليفون/i);
  expect(response.headers['cache-control']).toBe('private, no-store');
});
it('writes exactly one audit per successful download with actor, timestamp, business, scope and month; JSON writes none', async () => {
  const audits = () => f.h.owner`SELECT actor_user_id,at,after FROM audit_log
    WHERE company_id=${f.company} AND action='attendance.report.downloaded' ORDER BY at,id`;
  const before = (await audits()).length;
  await get(f.branch,false);
  expect(await audits()).toHaveLength(before);
  await get();
  expect(await audits()).toHaveLength(before+1);
  await get('all');
  const rows = await audits();
  expect(rows).toHaveLength(before+2);
  expect(rows.at(-1)).toMatchObject({actor_user_id:f.userId,after:{business_id:f.business,branch_id:'all',month:'2026-10'}});
  expect(rows.at(-1)?.at).toBeDefined();
});
it('neutralizes an employee name starting an Excel formula, preserving signed numeric hours', async () => {
  await f.h.owner`UPDATE employees SET name_en='=SyntheticFormula()' WHERE company_id=${f.company} AND id=${f.employee.id}`;
  const response = await get();
  expect(response.payload).toContain('"\'=SyntheticFormula()"');
  expect(response.payload).toContain('"-220.00"');
});
