import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { attendanceActorNameStatement } from '../queries/attendance-actor-name.query.ts';
import { attendanceBoard } from '../queries/attendance-board.query.ts';
import {
  attendanceBoardFixture,
  seedManual,
  type BoardFixture,
} from './attendance-board.fixture.ts';
import { actorEmployee } from './attendance-actions-read.fixture.ts';
import { leaveIds } from './leave.fixture.ts';

let f: BoardFixture;
beforeAll(async () => {
  f = await attendanceBoardFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const statement = (userId = f.approverId) =>
  sql`SELECT ${attendanceActorNameStatement(sql`${f.company}::uuid`, sql`${userId}::uuid`)} AS name`;

it('projects only bilingual names across company businesses and chooses a deterministic employee', async () => {
  const foreignBusiness = await actorEmployee(f);
  const sameBusiness = await actorEmployee(f, f.approverId, f.business);
  await f.h
    .owner`UPDATE employees SET name_en='Synthetic alternative' WHERE company_id=${f.company} AND id=${sameBusiness.id}`;
  const expected =
    f.business < f.secondBusiness
      ? { ...sameBusiness.name, en: 'Synthetic alternative' }
      : foreignBusiness.name;
  const rows = await f.db.withTenant(f.company, (tx) => tx.execute<{ name: unknown }>(statement()));
  expect(rows[0]?.name).toEqual(expected);
  const manual = await seedManual(f);
  const board = await f.db.withTenant(f.company, (tx) =>
    attendanceBoard(tx, f.scope, f.boardClock.now(), '2026-10-04'),
  );
  expect(
    board.sessions.find((row) => row.id === manual.sessionId)?.manual?.approved_by_name,
  ).toEqual(expected);
});
it('returns null for absent or deleted actor employees and cannot read actor names across tenants', async () => {
  const rows = await f.db.withTenant(f.company, (tx) =>
    tx.execute<{ name: unknown }>(statement(leaveIds.newId())),
  );
  expect(rows[0]?.name).toBeNull();
  await f.h
    .owner`UPDATE employees SET deleted_at=now() WHERE company_id=${f.company} AND user_id=${f.approverId}`;
  expect(
    (await f.db.withTenant(f.company, (tx) => tx.execute<{ name: unknown }>(statement())))[0]?.name,
  ).toBeNull();
  expect(
    (
      await f.db.withTenant(f.otherCompany, (tx) =>
        tx.execute<{ name: unknown }>(statement(f.userId)),
      )
    )[0]?.name,
  ).toBeNull();
});
it('EXPLAIN ANALYZE uses the employee company/user lookup index', async () => {
  const ids = Array.from({ length: 2000 }, () => leaveIds.newId());
  await f.h
    .owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
    SELECT ${f.company},id,${f.business},${f.branch},'Synthetic filler','synthetic filler','staff','2026-01-01'
    FROM unnest(${ids}::uuid[]) AS id`;
  await f.h.owner`ANALYZE employees`;
  await f.db.withTenant(f.company, async (tx) => {
    const plan = await tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) ${statement()}`);
    expect(JSON.stringify(plan)).toMatch(
      /employees_(company_user_idx|user_id_idx|active_user_business_key)/,
    );
    expect(JSON.stringify(plan)).toContain('user_id =');
  });
});
