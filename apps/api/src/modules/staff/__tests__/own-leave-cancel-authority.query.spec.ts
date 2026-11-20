import { sql } from 'drizzle-orm';
import { SYSTEM_ROLES } from '@pospay/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  ownLeaveCancelAuthority,
  ownLeaveCancelAuthoritySql,
} from '../queries/leave-requests.query.ts';
import {
  leaveActor,
  leaveContext,
  leaveFixture,
  leaveIds,
  leaveTerms,
  type LeaveFixture,
} from './leave.fixture.ts';

let f: LeaveFixture;
let made: string;
let madeByManager: string;
// سياق الجلسة الذاتية نفسه اللي بيبنيه المسار: الموظفة بتتحدد من المستخدم مش من employeeId.
const ownContext = () => ({ ...leaveContext(f), own: true, branchId: f.branch });
const authority = (leaveId: string, companyId = f.company) =>
  f.db.withTenant(companyId, (tx) => ownLeaveCancelAuthority(tx, ownContext(), leaveId, f.access));
type PlanNode = {
  'Node Type'?: string;
  'Index Name'?: string;
  Plans?: PlanNode[];
};
function planNodes(explain: unknown): PlanNode[] {
  const cell = (explain as Array<Record<string, unknown>>)[0]?.['QUERY PLAN'];
  const plans = Array.isArray(cell) ? cell : cell === undefined ? [] : [cell];
  const walk = (node: PlanNode | undefined): PlanNode[] =>
    node === undefined ? [] : [node, ...(node.Plans ?? []).flatMap(walk)];
  return plans.flatMap((plan) => walk((plan as { Plan?: PlanNode }).Plan));
}
beforeAll(async () => {
  f = await leaveFixture();
  made = (await f.request.execute(leaveActor(f), leaveTerms('2027-01-01'))).id;
  const manager = SYSTEM_ROLES.find((role) => role.code === 'business_manager');
  if (!manager) throw new Error('Missing manager role');
  const managerUser = leaveIds.newId();
  await f.h
    .owner`INSERT INTO "user"(id,name,email) VALUES(${managerUser},'Synthetic leave plan manager','own-leave-cancel-authority-plan-manager@example.test')`;
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    VALUES(${f.company},${leaveIds.newId()},${managerUser},${manager.id},'global','BUSINESS',${f.business},'2026-01-01')`;
  madeByManager = (
    await f.request.execute({ ...leaveActor(f), userId: managerUser }, leaveTerms('2027-02-01'))
  ).id;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
it('confirms the flag only for her own pending request', async () => {
  expect(await authority(made)).toBe(true);
});
it('answers false for unknown ids and after the request is cancelled', async () => {
  expect(await authority(leaveIds.newId())).toBe(false);
  await f.cancel.execute({ ...leaveActor(f), leaveId: made }, { expected_revision: 1 });
  expect(await authority(made)).toBe(false);
});
it('never confirms a request the caller did not make or another tenant row', async () => {
  expect(await authority(madeByManager)).toBe(false);
  expect(await authority(made, f.otherCompany)).toBe(false);
});
it('EXPLAIN ANALYZE proves a primary-key index lookup with no Seq Scan and no Sort', async () => {
  // بذر كافي للإحصاءات: بدونه التقديرات بتتعادل بين فهارس الموظف والمخطط بيتختار بالصدفة.
  for (let n = 0; n < 40; n += 1) {
    const day = new Date(Date.UTC(2031, 0, 1 + n)).toISOString().slice(0, 10);
    await f.h
      .owner`INSERT INTO leave_requests(company_id,id,business_id,branch_id,employee_id,kind,"from","to",timezone,starts_at,ends_at,type,requested_by,requested_at)
      VALUES(${f.company},${leaveIds.newId()},${f.business},${f.branch},${f.employee.id},'FULL_DAY',${day},${day},'Asia/Kuwait',${`${day}T00:00:00Z`}::timestamptz,${new Date(Date.UTC(2031, 0, 2 + n)).toISOString()}::timestamptz,'ANNUAL',${f.userId},'2026-10-04T10:00:00Z'::timestamptz)`;
  }
  await f.h.owner`ANALYZE leave_requests`;
  const explain = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${ownLeaveCancelAuthoritySql(ownContext(), made, {
        branches: [f.branch],
        cancelBranches: [f.branch],
      })}`,
    );
  });
  const nodes = planNodes(explain);
  // الأربعة شروط مساواة كلها مثبتة، في تلات فهارس مرشحة لنفس صف واحد: المفتاح الأساسي وفهارسه المركبة المكافئة؛
  // اختيار المخطط بينهم مش حاسم عبر أحجام البيانات، فالثبات المطلوب هو: بحث مفهرس بصف واحد بلا Seq Scan ولا Sort.
  expect(
    nodes.some((node) =>
      [
        'leave_requests_pkey',
        'leave_requests_company_business_id_idx',
        'leave_requests_company_employee_id_idx',
      ].includes(node['Index Name'] ?? ''),
    ),
  ).toBe(true);
  expect(nodes.some((node) => node['Node Type'] === 'Seq Scan')).toBe(false);
  expect(nodes.some((node) => node['Node Type'] === 'Sort')).toBe(false);
});
