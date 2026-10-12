import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  attendanceExceptionPage,
  attendanceCorrectionHistory as historyContract,
} from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import {
  attendanceExceptions,
  attendanceExceptionsStatement,
} from '../queries/attendance-exceptions.query.ts';
import {
  attendanceCorrectionHistory,
  attendanceCorrectionHistoryStatement,
} from '../queries/attendance-correction-history.query.ts';
import {
  attendanceActionsReadFixture,
  seedActionHistory,
  type ActionsReadFixture,
} from './attendance-actions-read.fixture.ts';
import { leaveIds } from './leave.fixture.ts';

let f: ActionsReadFixture;
beforeAll(async () => {
  f = await attendanceActionsReadFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const list = (status: 'OPEN' | 'RESOLVED' = 'OPEN', limit = 50, cursor?: string) =>
  f.db.withTenant(f.company, (tx) =>
    attendanceExceptions(tx, f.scope, { status, limit, ...(cursor ? { cursor } : {}) }),
  );
const history = (sessionId: string) =>
  f.db.withTenant(f.company, (tx) => attendanceCorrectionHistory(tx, f.scope, sessionId));

it('projects the exception page, excludes voided sessions, and retains resolution and revision fields', async () => {
  const page = attendanceExceptionPage.parse(await list());
  expect(page.items.map((row) => row.id)).toEqual([f.visible.id, f.second.id].sort().reverse());
  expect(page.next_cursor).toBeNull();
  expect(page.items[0]).toMatchObject({
    employee: { id: f.employee.id, name_ar: f.employee.name_ar, name_en: f.employee.name_en },
    session: {
      working_date: '2026-10-04',
      clock_in: '2026-10-04T08:00:00.000Z',
      clock_out: '2026-10-04T09:00:00.000Z',
      status: 'CLOSED',
    },
    status: 'OPEN',
    resolution: null,
    resolved_by: null,
    resolved_at: null,
    reason: null,
    revision: 0,
  });
  expect((await list('RESOLVED')).items).toEqual([
    expect.objectContaining({
      id: f.resolved.id,
      resolution: 'ACKNOWLEDGED',
      resolved_by: f.approverId,
      resolved_at: '2026-10-04T10:00:00.000Z',
      reason: 'synthetic',
      revision: 1,
    }),
  ]);
  for (const key of ['phone', 'salary', 'iban', 'document'])
    expect(JSON.stringify(page)).not.toContain(key);
});
it('keyset pagination handles tied timestamps and preserves PostgreSQL microseconds', async () => {
  await f.h.owner`UPDATE attendance_exceptions SET raised_at='2026-10-04T08:00:00.123456Z'
    WHERE company_id=${f.company} AND id IN (${f.visible.id},${f.second.id})`;
  const first = await list('OPEN', 1);
  expect(first.next_cursor).toContain('.123456Z|');
  const second = await list('OPEN', 1, first.next_cursor ?? '');
  expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(2);
  expect(second.next_cursor).toBeNull();
});
it('reads only sessions at the requested branch when an exception has a different movement branch', async () => {
  await f.h.owner`UPDATE attendance_exceptions SET branch_id=${f.secondBranch}
    WHERE company_id=${f.company} AND id=${f.visible.id}`;
  try {
    expect((await list()).items.find((row) => row.id === f.visible.id)?.branch_id).toBe(f.branch);
    const other = await f.db.withTenant(f.company, (tx) =>
      attendanceExceptions(
        tx,
        { ...f.scope, branchId: f.secondBranch },
        { status: 'OPEN', limit: 50 },
      ),
    );
    expect(other.items.some((row) => row.id === f.visible.id)).toBe(false);
  } finally {
    await f.h.owner`UPDATE attendance_exceptions SET branch_id=${f.branch}
      WHERE company_id=${f.company} AND id=${f.visible.id}`;
  }
});
it('correction history remains readable after void, oldest first with deterministic ties and actor names', async () => {
  const result = historyContract.parse(await history(f.hidden.sessionId));
  expect(result.items.map((row) => row.id)).toEqual([
    f.corrections[1],
    ...[f.corrections[0], f.corrections[2]].sort(),
  ]);
  expect(result.items[0]).toMatchObject({
    field: 'CLOCK_OUT',
    before_at: '2026-10-04T08:00:00.000Z',
    after_at: '2026-10-04T09:00:00.000Z',
    reason: 'synthetic reason',
    corrected_by: { id: f.userId, name: { ar: f.employee.name_ar, en: f.employee.name_en } },
  });
  expect(result.items[1]?.corrected_by).toEqual({ id: f.approverId, name: f.actor.name });
  expect(await history(f.empty)).toEqual({ items: [] });
  expect(await history(f.otherBranchSession)).toBeNull();
  expect(await history(leaveIds.newId())).toBeNull();
});
it('a deleted actor employee keeps her name on past corrections', async () => {
  await f.h
    .owner`UPDATE employees SET deleted_at=now() WHERE company_id=${f.company} AND id=${f.actor.id}`;
  try {
    expect((await history(f.hidden.sessionId))?.items[1]?.corrected_by).toEqual({
      id: f.approverId,
      name: f.actor.name,
    });
  } finally {
    await f.h
      .owner`UPDATE employees SET deleted_at=NULL WHERE company_id=${f.company} AND id=${f.actor.id}`;
  }
});
it('tenant RLS hides exceptions and corrections even when query scope names the foreign tenant', async () => {
  await f.db.withTenant(f.otherCompany, async (tx) => {
    expect(await attendanceExceptions(tx, f.scope, { status: 'OPEN', limit: 50 })).toEqual({
      items: [],
      next_cursor: null,
    });
    expect(await attendanceCorrectionHistory(tx, f.scope, f.hidden.sessionId)).toBeNull();
    for (const table of ['attendance_exceptions', 'attendance_corrections', 'employees']) {
      expect(
        await tx.execute(
          sql`SELECT id FROM ${sql.identifier(table)} WHERE company_id=${f.company}`,
        ),
      ).toHaveLength(0);
    }
  });
});
it('EXPLAIN ANALYZE drives LIMIT from ordered exceptions without sorting the branch history', async () => {
  await seedActionHistory(f);
  await f.db.withTenant(f.company, async (tx) => {
    for (const status of ['OPEN', 'RESOLVED'] as const) {
      for (const cursor of [undefined, `2026-10-03T00:00:00Z|${f.visible.id}`]) {
        const query = { status, limit: 50, ...(cursor ? { cursor } : {}) };
        const [row] = await tx.execute<{ 'QUERY PLAN': { Plan: ExplainNode }[] }>(
          sql`EXPLAIN (ANALYZE,FORMAT JSON) ${attendanceExceptionsStatement(f.scope, query)}`,
        );
        const root = row?.['QUERY PLAN'][0]?.Plan;
        expect(root?.['Node Type']).toBe('Limit');
        const nodes = planNodes(root);
        const scan = nodes.find((node) => node['Index Name'] === 'attendance_exceptions_list_idx');
        expect(nodes.filter((node) => node['Node Type'].includes('Sort'))).toEqual([]);
        expect(scan?.['Node Type']).toBe('Index Scan');
        expect(scan?.['Actual Loops']).toBe(1);
        expect(scan?.['Actual Rows']).toBeLessThanOrEqual(query.limit + 2);
        expect(root?.['Actual Rows']).toBe(query.limit + 1);
      }
    }
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const plan = await tx.execute(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${attendanceCorrectionHistoryStatement(f.scope, f.hidden.sessionId)}`,
    );
    expect(JSON.stringify(plan)).toContain('attendance_corrections_session_idx');
    expect(JSON.stringify(plan)).toContain('attendance_sessions_company_id_id_pk');
  });
});
interface ExplainNode {
  'Node Type': string;
  'Index Name'?: string;
  'Actual Rows': number;
  'Actual Loops': number;
  Plans?: ExplainNode[];
}
function planNodes(node: ExplainNode | undefined): ExplainNode[] {
  return node ? [node, ...(node.Plans ?? []).flatMap(planNodes)] : [];
}
it('cross-tenant exception and correction inserts are rejected by RLS', async () => {
  const statements = [
    sql`INSERT INTO attendance_exceptions(company_id,id,business_id,branch_id,employee_id,session_id,kind,raised_at)
      VALUES(${f.company},${leaveIds.newId()},${f.business},${f.branch},${f.employee.id},${f.visible.sessionId},'NONE','2026-10-04T08:00:00Z')`,
    sql`INSERT INTO attendance_corrections(company_id,id,business_id,branch_id,employee_id,session_id,request_id,field,before_at,after_at,reason,corrected_by,corrected_at)
      VALUES(${f.company},${leaveIds.newId()},${f.business},${f.branch},${f.employee.id},${f.visible.sessionId},${leaveIds.newId()},
        'CLOCK_OUT','2026-10-04T08:00:00Z','2026-10-04T09:00:00Z','synthetic',${f.approverId},'2026-10-04T10:00:00Z')`,
  ];
  for (const statement of statements)
    await expect(
      f.db.withTenant(f.otherCompany, (tx) => tx.execute(statement)),
    ).rejects.toMatchObject({
      cause: { code: '42501' },
    });
});
