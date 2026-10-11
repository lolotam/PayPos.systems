import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { contractedMinutes } from '@pospay/domain';
import { defaultHoursFixture, hoursCommand, type DefaultHoursFixture } from './employee-default-shifts.fixture.ts';
import { employeeContractedMinutes, employeeContractedMinutesStatement } from '../queries/employee-contracted-minutes.query.ts';

let f: DefaultHoursFixture;
beforeAll(async () => { f = await defaultHoursFixture(); });
afterAll(async () => { await f?.db.close(); await f?.h.close(); });

it('DH-10 returns the branch defaults and eligibility intervals: Sara October 2026 = 228 hours', async () => {
  await f.setHours.execute(hoursCommand(f));
  const rows = await f.db.withTenant(f.company, (tx) =>
    employeeContractedMinutes(tx, f.company, f.business, f.branch, '2026-10-01', '2026-10-31'));
  const sara = rows.find((row) => row.employee_id === f.employee.id);
  expect(sara).toBeDefined();
  if (!sara) throw new Error('MISSING_SYNTHETIC_EMPLOYEE');
  const dates = Array.from({ length: 31 }, (_, i) => {
    const date = `2026-10-${String(i + 1).padStart(2, '0')}`;
    return { date, weekday: (new Date(`${date}T00:00:00Z`).getUTCDay() + 1) % 7 };
  }).filter(({ date }) => date >= sara.hire_date && (!sara.contract_end || date <= sara.contract_end)
    && sara.links.some((link) => link.from <= date && (!link.to || date < link.to)));
  expect(contractedMinutes(sara.entries, dates)).toBe(13680);
  expect(await f.db.withTenant(f.company, (tx) =>
    employeeContractedMinutes(tx, f.company, f.business, f.secondBranch, '2026-10-01', '2026-10-31')))
    .toMatchObject([{ employee_id: f.employee.id, entries: [] }]);
  const plans = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${employeeContractedMinutesStatement(f.company, f.business, f.branch, '2026-10-01', '2026-10-31')}`);
  });
  expect(JSON.stringify(plans)).toContain('employee_default_shifts_company_business_branch_idx');
});
