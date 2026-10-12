import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@pospay/db';
import { PgDialect } from 'drizzle-orm/pg-core';
import { catalogReader } from '../persistence/catalog-reader.adapter.ts';
import { customerLookup } from '../persistence/customer-lookup.adapter.ts';
import { performerCheck } from '../persistence/performer-check.adapter.ts';
import { sessionFixture, ids, must, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
beforeAll(async () => { f = await sessionFixture(); });
afterAll(async () => { await f?.close(); });

it('provider shapes map all four rules and mask phone before orders; index EXPLAIN covers bounded reads', async () => {
  const extra = JSON.stringify(Array.from({ length: 300 }, (_, i) => ({ id: ids.newId(), name: `Synthetic indexed service ${i}` })));
  await f.h.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    SELECT ${f.company},r.id,${f.business},r.name,1.000,'ZERO' FROM jsonb_to_recordset(${extra}::text::jsonb) AS r(id uuid,name text)`;
  await f.db.withTenant(f.company, async (tx) => {
    const statements: SQL[] = [];
    const proxy = new Proxy(tx, { get: (target, prop, receiver) => prop === 'execute' ? (query: SQL) => {
      statements.push(query); return target.execute(query);
    } : Reflect.get(target, prop, receiver) }) as Tx;
    const services = await catalogReader(proxy, f.company, f.business).read(f.services);
    expect(services.map((s) => s.rule.kind)).toEqual(['FOLLOW_PLAN','PCT','ZERO','FIXED']);
    expect(services[3]?.rule).toEqual({ kind: 'FIXED', value: 2500n });
    const customer = await customerLookup(proxy, f.company).read(f.customer);
    expect(customer?.phone_masked).toContain('123'); expect(JSON.stringify(customer)).not.toContain('+999999998');
    const employees = await performerCheck(proxy, f.company, f.business, f.branch).read(f.employees, new Date('2026-10-14T08:00:00Z'));
    expect(employees).toHaveLength(4); expect(employees.every((e) => e.user_id === null && e.eligible && !e.clocked_in && !e.approved_leave)).toBe(true);
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const dialect = new PgDialect();
    for (const query of statements.filter((s) => /FROM services|FROM customers|FROM employees e/.test(dialect.sqlToQuery(s).sql))) {
      const plan = await tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) ${query}`);
      expect(JSON.stringify(plan)).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
    }
  });
});

it('staff owns dated branch eligibility, persisted user links, inclusive contract end and leave warning facts', async () => {
  const employee = must(f.employees[0]);
  await f.h.owner`UPDATE employees SET contract_end='2026-10-14',user_id=${f.userId} WHERE company_id=${f.company} AND id=${employee}`;
  await f.h.owner`INSERT INTO leave_requests(company_id,id,business_id,branch_id,employee_id,kind,"from","to",timezone,starts_at,ends_at,type,status,requested_by,requested_at,decided_by,decided_at)
    VALUES(${f.company},${ids.newId()},${f.business},${f.branch},${employee},'FULL_DAY','2026-10-14','2026-10-14','Asia/Kuwait',
      '2026-10-13T21:00:00Z','2026-10-14T21:00:00Z','ANNUAL','APPROVED',${f.userId},now(),${f.ownerId},now())`;
  const read = (at: string) => f.db.withTenant(f.company, (tx) => performerCheck(tx, f.company, f.business, f.branch).read([employee], new Date(at)));
  expect((await read('2026-10-14T08:00:00Z'))[0]).toMatchObject({ user_id: f.userId, eligible: true, approved_leave: true });
  expect((await read('2026-10-15T08:00:00Z'))[0]).toMatchObject({ eligible: false, approved_leave: false });
  await f.h.owner`UPDATE employees SET contract_end=NULL,user_id=NULL WHERE company_id=${f.company} AND id=${employee}`;
  await f.h.owner`UPDATE employee_branches SET "to"='2026-10-14' WHERE company_id=${f.company} AND employee_id=${employee}`;
  expect((await read('2026-10-14T08:00:00Z'))[0]?.eligible).toBe(false);
  await f.h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${f.company},${ids.newId()},${f.business},${employee},${f.branch},'2026-10-14')`;
});

it('approved partial leave uses original instant [start,end) and the branch working day independently of business date', async () => {
  const employee = must(f.employees[1]);
  await f.h.owner`UPDATE branches SET timezone='America/New_York' WHERE company_id=${f.company} AND id=${f.branch}`;
  await f.h.owner`INSERT INTO leave_requests(company_id,id,business_id,branch_id,employee_id,kind,"from","to",start,"end",timezone,starts_at,ends_at,type,status,requested_by,requested_at,decided_by,decided_at)
    VALUES(${f.company},${ids.newId()},${f.business},${f.branch},${employee},'PARTIAL','2026-10-13','2026-10-13','21:00','23:00','America/New_York',
      '2026-10-14T01:00:00Z','2026-10-14T03:00:00Z','ANNUAL','APPROVED',${f.userId},now(),${f.ownerId},now())`;
  const read = (at: string) => f.db.withTenant(f.company, (tx) => performerCheck(tx, f.company, f.business, f.branch).read([employee], new Date(at)));
  expect((await read('2026-10-14T01:00:00Z'))[0]?.approved_leave).toBe(true);
  expect((await read('2026-10-14T02:59:59.999Z'))[0]?.approved_leave).toBe(true);
  expect((await read('2026-10-14T03:00:00Z'))[0]?.approved_leave).toBe(false);
  await f.h.owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,
    clock_in,clock_out,status,source,geo,out_geo,closed_by,late_minutes)
    VALUES(${f.company},${ids.newId()},${f.business},${f.branch},${employee},'2026-10-13','America/New_York',
      '2026-10-14T01:00:00Z','2026-10-14T02:00:00Z','CLOSED','QR','NONE','NONE','EMPLOYEE',0)`;
  expect((await read('2026-10-14T01:30:00Z'))[0]).toMatchObject({ clocked_in: true, approved_leave: true });
  expect((await read('2026-10-15T01:30:00Z'))[0]?.clocked_in).toBe(false);
  await f.h.owner`UPDATE branches SET timezone=NULL WHERE company_id=${f.company} AND id=${f.branch}`;
});

it('20-line/80-performer HTTP batches have bounded statements and a warmed median below 200ms', async () => {
  const send = (lines: ReturnType<typeof f.line>[]) => f.h.send('POST', f.base, { cookie: f.cookie, company: f.company, key: ids.newId(), body: { customer_id: f.customer, lines } });
  const before = f.h.calls.statements.length; expect((await send([f.line()])).status).toBe(201);
  const single = f.h.calls.statements.length - before;
  const lines = Array.from({ length: 20 }, () => ({ ...f.line(), performers: f.employees.map((employee_id) => ({ employee_id })) }));
  const samples: number[] = [], counts: number[] = [];
  // نفس معيار تقارير الحضور: تسخين مرتين ثم وسيط عشر عينات؛ نعرض المجال أيضاً ولا نخفي العينة البطيئة.
  for (let index = 0; index < 12; index++) {
    const start = performance.now(), countBefore = f.h.calls.statements.length;
    const result = await send(lines); const elapsed = performance.now() - start;
    expect(result.status).toBe(201);
    const count = f.h.calls.statements.length - countBefore; expect(count).toBeLessThanOrEqual(single + 2);
    if (index >= 2) { samples.push(elapsed); counts.push(count); }
  }
  const sorted = samples.toSorted((a,b) => a-b), median = (must(sorted[4]) + must(sorted[5])) / 2;
  process.stdout.write(`35a 20-line/80-performer HTTP: median ${median.toFixed(1)}ms, range ${Math.min(...samples).toFixed(1)}–${Math.max(...samples).toFixed(1)}ms, ${[...new Set(counts)].join('/')} statements, 10 samples (target 200ms)\n`);
  expect(median).toBeLessThan(200);
});
