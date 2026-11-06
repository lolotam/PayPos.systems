import { afterAll, beforeAll, expect, it } from 'vitest';
import { leavePage, type EmployeeLeaveListQuery } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { EmployeeLeaveController } from '../http/employee-leave.controller.ts';
import { createLeaveReadAccess } from '../persistence/leave-read-access.adapter.ts';
import { employeeLeaveHistory, leavePageSql } from '../queries/leave-requests.query.ts';
import { leaveContext, leaveFixture, leaveIds, type LeaveFixture } from './leave.fixture.ts';
import { personalFixture, personalOrigin } from '../../../../test/personal-staff.fixture.ts';
import { createPersonalEligibility } from '../persistence/personal-employee.ts';
import { termsFor } from './employees.fixture.ts';

let f: LeaveFixture;
const NOW = new Date('2026-10-04T10:00:00Z');
beforeAll(async () => {
  f = await leaveFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const read = (query: EmployeeLeaveListQuery, now = NOW) =>
  f.db.withTenant(f.company, (tx) =>
    employeeLeaveHistory(tx, leaveContext(f), query, createLeaveReadAccess({ now: () => now })),
  );

async function insert(options: {
  to: string;
  status?: 'PENDING' | 'APPROVED';
  timezone?: string;
  branch?: string;
  startsAt?: string;
  employee?: string;
}) {
  const id = leaveIds.newId();
  const pending = options.status === 'PENDING';
  await f.h.owner`INSERT INTO leave_requests(company_id,id,business_id,branch_id,employee_id,kind,
    "from","to",timezone,starts_at,ends_at,type,status,requested_by,requested_at,decided_by,decided_at)
    VALUES(${f.company},${id},${f.business},${options.branch ?? f.branch},${options.employee ?? f.employee.id},'FULL_DAY',
    ${options.to},${options.to},${options.timezone ?? 'Asia/Kuwait'},
    ${options.startsAt ?? `${options.to}T00:00:00Z`}::timestamptz,
    ${options.startsAt ?? `${options.to}T00:00:00Z`}::timestamptz + interval '1 hour',
    'ANNUAL',${options.status ?? 'APPROVED'},${f.userId},${NOW},
    ${pending ? null : f.userId},${pending ? null : NOW})`;
  return id;
}

async function clear() {
  await f.h.owner`DELETE FROM leave_requests WHERE company_id=${f.company}`;
}

async function seedRequests(count: number) {
  const ids = Array.from({ length: count }, () => leaveIds.newId());
  await f.h.owner`INSERT INTO leave_requests(company_id,id,business_id,branch_id,employee_id,kind,
    "from","to",timezone,starts_at,ends_at,type,status,requested_by,requested_at,decided_by,decided_at)
    SELECT ${f.company},seed.id,${f.business},${f.branch},${f.employee.id},'FULL_DAY',
      date '2027-01-01' + seed.n::int,date '2027-01-01' + seed.n::int,'Asia/Kuwait',
      timestamptz '2027-01-01T00:00:00Z' + seed.n * interval '1 day',
      timestamptz '2027-01-01T01:00:00Z' + seed.n * interval '1 day',
      'ANNUAL','APPROVED',${f.userId},${NOW},${f.userId},${NOW}
    FROM unnest(${f.h.owner.array(ids)}::uuid[]) WITH ORDINALITY AS seed(id,n)`;
  return ids;
}

it('LH-21 includes today and old pending requests but excludes yesterday', async () => {
  await clear();
  const today = await insert({ to: '2026-10-04' });
  await insert({ to: '2026-10-03' });
  const pending = await insert({ to: '2026-01-01', status: 'PENDING' });
  const page = leavePage.parse(await read({ open: 'true', limit: 20 }));
  expect(page.items.map((row) => row.id)).toEqual([today, pending]);
  expect(page.request_branch_ids.sort()).toEqual([f.branch, f.secondBranch].sort());
});

it('LH-21 uses each saved timezone at the same instant', async () => {
  await clear();
  const kuwait = await insert({ to: '2026-10-04', timezone: 'Asia/Kuwait' });
  const other = await f.useCase.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    input: termsFor(f, 'Synthetic Tokyo employee'),
  });
  await insert({ to: '2026-10-04', timezone: 'Asia/Tokyo', employee: other.id });
  const now = new Date('2026-10-04T16:30:00Z');
  const context = { companyId: f.company, businessId: f.business, userId: f.userId, own: false };
  const allEmployees = (query: EmployeeLeaveListQuery) =>
    f.db.withTenant(f.company, (tx) =>
      employeeLeaveHistory(tx, context, query, createLeaveReadAccess({ now: () => now })),
    );
  expect(leavePage.parse(await allEmployees({ limit: 20 })).items).toHaveLength(2);
  expect(
    leavePage.parse(await allEmployees({ open: 'true', limit: 20 })).items.map((r) => r.id),
  ).toEqual([kuwait]);
});

it('LH-21 filters the branch before paging', async () => {
  await clear();
  const visible = await insert({ to: '2026-10-04' });
  await insert({ to: '2026-10-05', branch: f.secondBranch });
  await f.h.owner`UPDATE memberships SET scope_type='BRANCH',scope_id=${f.branch}
    WHERE company_id=${f.company} AND id=${f.memberId}`;
  try {
    const page = leavePage.parse(await read({ open: 'true', limit: 1 }));
    expect(page.items.map((row) => row.id)).toEqual([visible]);
    expect(page.next_cursor).toBeNull();
  } finally {
    await f.h.owner`UPDATE memberships SET scope_type='BUSINESS',scope_id=${f.business}
      WHERE company_id=${f.company} AND id=${f.memberId}`;
  }
});

it('LH-21 pages more than 100 open requests without loss or duplication', async () => {
  await clear();
  const expected = await seedRequests(103);
  const first = leavePage.parse(await read({ open: 'true', limit: 100 }));
  expect(first.items).toHaveLength(100);
  expect(first.next_cursor).toBe(expected[99]);
  if (!first.next_cursor) throw new Error('Expected next cursor');
  const second = leavePage.parse(
    await read({ open: 'true', limit: 100, cursor: first.next_cursor }),
  );
  expect(second.next_cursor).toBeNull();
  expect([...first.items, ...second.items].map((row) => row.id)).toEqual(expected);
});

// اختبارات الـoffset المباشرة بتثبت مقارنة الـinstants بس؛ عقد HTTP بيقبل Z فقط.
it.each([
  { as_of: '2026-10-04T10:00:00.001Z', accepted: false },
  { as_of: '2026-10-03T09:59:59.999Z', accepted: false },
  { as_of: '2026-10-04T10:00:00.000Z', accepted: true },
  { as_of: '2026-10-03T10:00:00.000Z', accepted: true },
  { as_of: '2026-10-04T12:00:00+03:00', accepted: true },
  { as_of: '2026-10-04T08:00:00-01:00', accepted: true },
  { as_of: '2026-10-04T13:00:00.001+03:00', accepted: false },
  { as_of: '2026-10-03T12:59:59.999+03:00', accepted: false },
  { as_of: '2026-10-04T09:00:00.001-01:00', accepted: false },
  { as_of: '2026-10-03T08:59:59.999-01:00', accepted: false },
])('LH-24 bounds parsed instant $as_of, inclusive=$accepted', async ({ as_of, accepted }) => {
  const controller = new EmployeeLeaveController(
    null,
    null,
    f.db,
    createLeaveReadAccess({ now: () => NOW }),
  );
  const request = { principal: { companyId: f.company, userId: f.userId } } as FastifyRequest;
  const response = controller.list(
    f.business,
    f.employee.id,
    { open: 'true', as_of, limit: 20 },
    request,
  );
  if (accepted) expect(leavePage.safeParse(await response).success).toBe(true);
  else
    await expect(response).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      details: [{ path: ['as_of'], code: 'custom' }],
    });
});

it('LH-24 keeps the previous local date across midnight', async () => {
  await clear();
  const id = await insert({ to: '2026-10-03' });
  const now = new Date('2026-10-03T21:00:00.001Z');
  expect(leavePage.parse(await read({ open: 'true', limit: 20 }, now)).items).toEqual([]);
  const before = await read({ open: 'true', as_of: '2026-10-03T20:59:59.999Z', limit: 20 }, now);
  expect(leavePage.parse(before).items.map((row) => row.id)).toEqual([id]);
});

it('employee HTTP accepts a Z instant and refuses offsets at the schema boundary', async () => {
  const url = `/v1/businesses/${f.business}/employees/${f.employee.id}/leave-requests`;
  const headers = { cookie: f.cookie, 'x-company-id': f.company };
  const accepted = await f.h.app.inject({
    method: 'GET',
    headers,
    url: `${url}?${new URLSearchParams({ open: 'true', as_of: new Date().toISOString() })}`,
  });
  expect(accepted.statusCode).toBe(200);
  expect(leavePage.safeParse(accepted.json()).success).toBe(true);
  const rejected = await f.h.app.inject({
    method: 'GET',
    headers,
    url: `${url}?${new URLSearchParams({ open: 'true', as_of: '2026-10-04T13:00:00+03:00' })}`,
  });
  expect(rejected.statusCode).toBe(400);
  expect(rejected.json()).toMatchObject({
    code: 'VALIDATION_FAILED',
    details: [{ path: ['as_of'], code: 'invalid_format' }],
  });
});

it('LH-24 leaves can_* flags on the permission clock while as_of moves the split', async () => {
  await clear();
  await f.h
    .owner`UPDATE employees SET user_id=NULL WHERE company_id=${f.company} AND id=${f.employee.id}`;
  try {
    const id = await insert({ to: '2026-10-04', startsAt: '2026-10-04T09:30:00Z' });
    const current = leavePage.parse(await read({ open: 'true', limit: 20 }));
    const past = leavePage.parse(
      await read({ open: 'true', limit: 20, as_of: '2026-10-04T09:00:00Z' }),
    );
    expect(past).toEqual(current);
    expect(past.items[0]).toMatchObject({
      id,
      can_revoke: false,
      can_cancel: false,
      can_decide: false,
    });
    const earlier = leavePage.parse(
      await read({ open: 'true', limit: 20 }, new Date('2026-10-04T09:00:00Z')),
    );
    expect(earlier.items[0]?.can_revoke).toBe(true);
  } finally {
    await f.h
      .owner`UPDATE employees SET user_id=${f.userId} WHERE company_id=${f.company} AND id=${f.employee.id}`;
  }
});

it('without open keeps the old response, cursor and query text', async () => {
  await clear();
  await insert({ to: '2026-01-01' });
  await insert({ to: '2026-10-04' });
  await f.db.withTenant(f.company, async (tx) => {
    const context = leaveContext(f);
    const scope = await f.access.check(tx, context);
    if (!scope) throw new Error('Expected leave read scope');
    const legacySql = leavePageSql(context, { limit: 1 }, scope, false);
    const rows = await tx.execute<{ record: ReturnType<typeof leavePage.parse>['items'][number] }>(
      legacySql,
    );
    const first = rows[0]?.record;
    if (!first) throw new Error('Expected legacy row');
    const expected = {
      items: [first],
      next_cursor: first.id,
      request_branch_ids: scope.createBranches,
    };
    expect(await employeeLeaveHistory(tx, context, { limit: 1 }, f.access)).toEqual(expected);
    const text = new PgDialect().sqlToQuery(legacySql).sql;
    expect(text).not.toContain('AT TIME ZONE l.timezone');
    expect(text).not.toContain('OR l.status=');
    expect(text).toContain('ORDER BY l.id LIMIT');
    // بصمة SQL من نسخة da775eb5e قبل التعديل؛ تثبت إن المسار القديم حتى نصه ما اتغيرش.
    const baseline = new PgDialect().sqlToQuery(
      leavePageSql(
        context,
        { limit: 20 },
        {
          branches: [f.branch],
          cancelBranches: [],
          now: NOW,
        },
        false,
      ),
    ).sql;
    expect(createHash('sha256').update(baseline).digest('hex')).toBe(
      '7e81952b274d2d1ee00837484dd480bc054e45bcdf6f3a525f18d95047d2e0ca',
    );
  });
});

it('personal HTTP list refuses employee-only query keys and keeps its default response', async () => {
  const personal = await personalFixture();
  try {
    const session = await personal.auth.personal.issue(
      personal.userId,
      { purpose: 'STAFF_PERSONAL', companyId: personal.companyId, businessId: personal.businessId },
      () =>
        createPersonalEligibility(personal.database).eligible(personal.userId, {
          companyId: personal.companyId,
          businessId: personal.businessId,
        }),
    );
    const headers = { cookie: session.cookie.split(';')[0] ?? '', origin: personalOrigin };
    const url = `/v1/staff/me/leave-requests?branch_id=${personal.branchId}`;
    const before = await personal.app.inject({ method: 'GET', url, headers });
    expect(before.statusCode).toBe(200);
    expect(leavePage.parse(before.json()).items).toEqual([]);
    for (const query of ['open=true', 'as_of=2026-10-04T10:00:00Z']) {
      const response = await personal.app.inject({
        method: 'GET',
        url: `${url}&${query}`,
        headers,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('VALIDATION_FAILED');
    }
    const after = await personal.app.inject({ method: 'GET', url, headers });
    expect(after.statusCode).toBe(200);
    expect(after.json()).toEqual(before.json());
  } finally {
    await personal.close();
  }
});

it('open result shape and EXPLAIN ANALYZE use leave indexes on over 1000 requests', async () => {
  await clear();
  await seedRequests(1001);
  const page = leavePage.parse(await read({ open: 'true', limit: 20 }));
  expect(page.items).toHaveLength(20);
  expect(page.next_cursor).toBe(page.items[19]?.id);
  const plan = await f.db.withTenant(f.company, async (tx) => {
    const scope = await f.access.check(tx, leaveContext(f));
    if (!scope) throw new Error('Expected leave read scope');
    return tx.execute(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${leavePageSql(
        leaveContext(f),
        { open: 'true', limit: 20 },
        { ...scope, asOf: NOW.toISOString() },
        false,
      )}`,
    );
  });
  const json = JSON.stringify(plan);
  expect(json).toMatch(/leave_requests_(company_(employee|business)|pkey)/);
  expect(json).not.toMatch(/"Node Type":"Seq Scan"[^}]*"Relation Name":"leave_requests"/);
});
