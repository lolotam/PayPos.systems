import { leavePage } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  employeeLeaveHistory,
  leavePageSql,
  ownLeaveHistory,
} from '../queries/leave-requests.query.ts';
import { termsFor } from './employees.fixture.ts';
import {
  leaveActor,
  leaveContext,
  leaveFixture,
  leaveIds,
  leaveTerms,
  type LeaveFixture,
} from './leave.fixture.ts';

let f: LeaveFixture;
let ids: string[];
const newestFirst = (made: string[]) => [...made].reverse();
// سياق الجلسة الذاتية نفسه اللي بيبنيه المسار: الموظفة بتتحدد من المستخدم مش من employeeId.
const ownContext = () => ({ ...leaveContext(f), own: true, branchId: f.branch });
const ownPage = (query: { limit: number; cursor?: string }) =>
  f.db.withTenant(f.company, (tx) => ownLeaveHistory(tx, ownContext(), query, f.access));
const seedDay = (n: number) => new Date(Date.UTC(2031, 0, 1 + n)).toISOString().slice(0, 10);
const seedLeave = async (employeeId: string, count: number) => {
  for (let n = 0; n < count; n += 1) {
    const from = seedDay(n);
    await f.h
      .owner`INSERT INTO leave_requests(company_id,id,business_id,branch_id,employee_id,kind,"from","to",timezone,starts_at,ends_at,type,requested_by,requested_at)
      VALUES(${f.company},${leaveIds.newId()},${f.business},${f.branch},${employeeId},'FULL_DAY',${from},${from},'Asia/Kuwait',${`${from}T00:00:00Z`}::timestamptz,${`${seedDay(n + 1)}T00:00:00Z`}::timestamptz,'ANNUAL',${f.userId},'2026-10-04T10:00:00Z'::timestamptz)`;
  }
};
type PlanNode = {
  'Node Type'?: string;
  'Index Name'?: string;
  'Scan Direction'?: string;
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
  ids = [];
  for (const day of ['2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04', '2027-01-05'])
    ids.push((await f.request.execute(leaveActor(f), leaveTerms(day))).id);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
it('returns the contract page shape with the newest request first', async () => {
  const page = leavePage.parse(await ownPage({ limit: 20 }));
  expect(page.items.map((r) => r.id)).toEqual(newestFirst(ids));
  expect(page.items[0]).toMatchObject({ can_cancel: true });
  expect(page.next_cursor).toBeNull();
});
it('walks limit-2 pages newest first with no row skipped or repeated', async () => {
  const seen: string[] = [];
  let cursor: string | null = null;
  let lastNext: string | null = null;
  for (let guard = 0; guard < 10; guard += 1) {
    const page = leavePage.parse(
      await ownPage({ limit: 2, ...(cursor === null ? {} : { cursor }) }),
    );
    seen.push(...page.items.map((r) => r.id));
    lastNext = page.next_cursor;
    if (page.next_cursor === null) break;
    cursor = page.next_cursor;
  }
  expect(seen).toEqual(newestFirst(ids));
  expect(seen).toHaveLength(5);
  expect(lastNext).toBeNull();
});
it('a request created mid-pagination never skips or repeats an older page', async () => {
  const first = leavePage.parse(await ownPage({ limit: 2 }));
  expect(first.items.map((r) => r.id)).toEqual([ids[4], ids[3]]);
  const made = (await f.request.execute(leaveActor(f), leaveTerms('2027-01-06'))).id;
  ids.push(made);
  const second = leavePage.parse(await ownPage({ limit: 2, cursor: first.next_cursor as string }));
  expect(second.items.map((r) => r.id)).toEqual([ids[2], ids[1]]);
  const fresh = leavePage.parse(await ownPage({ limit: 2 }));
  expect(fresh.items.map((r) => r.id)).toEqual([made, ids[4]]);
});
it('a decision changes the status but keeps the newest request first', async () => {
  const newest = ids.at(-1) as string;
  await f.cancel.execute({ ...leaveActor(f), leaveId: newest }, { expected_revision: 1 });
  const page = leavePage.parse(await ownPage({ limit: 2 }));
  expect(page.items[0]).toMatchObject({ id: newest, status: 'CANCELLED' });
  expect(page.items.map((r) => r.id)).toEqual([newest, ids.at(-2)]);
});
it('own scope stays personal: colleague leave is left out, unknown employees and other companies read nothing', async () => {
  const colleague = await f.useCase.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    input: termsFor(f, 'Synthetic colleague'),
  });
  await seedLeave(colleague.id, 1);
  const mine = leavePage.parse(await ownPage({ limit: 100 }));
  expect(mine.items.length).toBeGreaterThan(0);
  expect(new Set(mine.items.map((r) => r.employee_id))).toEqual(new Set([f.employee.id]));
  for (const employeeId of [leaveIds.newId(), f.otherCompany])
    expect(
      await f.db.withTenant(f.company, (tx) =>
        ownLeaveHistory(tx, { ...ownContext(), employeeId }, { limit: 20 }, f.access),
      ),
    ).toBeNull();
  expect(
    await f.db.withTenant(f.otherCompany, (tx) =>
      ownLeaveHistory(tx, { ...ownContext(), companyId: f.otherCompany }, { limit: 20 }, f.access),
    ),
  ).toBeNull();
});
it('the admin employee list keeps ascending id order over the same rows', async () => {
  const admin = leavePage.parse(
    await f.db.withTenant(f.company, (tx) =>
      employeeLeaveHistory(tx, leaveContext(f), { limit: 20 }, f.access),
    ),
  );
  expect(admin.items.map((r) => r.id)).toEqual(ids);
});
it('EXPLAIN ANALYZE proves a backward index scan with no sort for newest-first paging', async () => {
  const neighbour = await f.useCase.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    input: termsFor(f, 'Synthetic plan neighbour'),
  });
  await seedLeave(f.employee.id, 60);
  await seedLeave(neighbour.id, 40);
  // إحصاءات طازجة بعد البذر؛ بدونها التقديرات بتتعادل بين الفهارس المرتبة والمخطط بيتختار بالصدفة.
  await f.h.owner`ANALYZE leave_requests`;
  // الكيرسر الحقيقي من الصفحة الأولى نفسها؛ تحته صفوف كافية يبين الفرق الحقيقي بين الفهارس.
  const page = leavePage.parse(await ownPage({ limit: 20 }));
  if (page.next_cursor === null) throw new Error('Expected a cursor for the paged plan');
  const cursor = page.next_cursor;
  const plans = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const c = leaveContext(f),
      scope = { branches: [f.branch], cancelBranches: [f.branch] };
    return [
      await tx.execute(
        sql`EXPLAIN (ANALYZE,FORMAT JSON) ${leavePageSql(c, { limit: 20 }, scope, false, 'newest')}`,
      ),
      await tx.execute(
        sql`EXPLAIN (ANALYZE,FORMAT JSON) ${leavePageSql(c, { limit: 20, cursor }, scope, false, 'newest')}`,
      ),
    ];
  });
  for (const explain of plans) {
    const nodes = planNodes(explain);
    // صيغة JSON تكتب المسح الخلفي كـ Scan Direction وليس داخل اسم العقدة كما في النص.
    expect(
      nodes.some(
        (node) =>
          node['Node Type'] === 'Index Scan' &&
          node['Scan Direction'] === 'Backward' &&
          node['Index Name'] === 'leave_requests_company_employee_id_idx',
      ),
    ).toBe(true);
    expect(nodes.some((node) => node['Node Type'] === 'Sort')).toBe(false);
  }
});
