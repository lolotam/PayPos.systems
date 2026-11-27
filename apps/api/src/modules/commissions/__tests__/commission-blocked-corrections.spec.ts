import { commissionBlockedCorrectionList } from '@pospay/contracts';
import { employeeNameMatchKey } from '@pospay/domain';
import { lockStatementPeriods, SYSTEM_ROLES } from '@pospay/db';
import { afterEach, beforeEach, expect, it } from 'vitest';

import {
  closeCommissionFixture,
  commissionPlanVersionsFixture,
  ids,
  memberWithoutPlanPermission,
  type CommissionPlanFixture,
} from './commission-plan-versions.fixture.ts';

type BlockedScope = {
  f: CommissionPlanFixture;
  otherBusiness: string;
  otherBusinessEmployee: string;
  foreignCompany: string;
  foreignBusiness: string;
  foreignEmployee: string;
};

const listPath = (businessId: string) =>
  `/v1/businesses/${businessId}/commission-blocked-corrections`;

/** بيقفل كشف هدف حقيقي لشهر معيّن، عشان FK الهدف المركّب يتكتب على كشف موجود. */
async function statementFor(
  f: CommissionPlanFixture,
  companyId: string,
  businessId: string,
  period: string,
): Promise<string> {
  let statementId = '';
  await f.db.withTenant(companyId, async (tx) => {
    const [locked] = await lockStatementPeriods(tx, { businessId, periods: [period], ids });
    if (locked === undefined) throw new Error('the target statement row is missing after its lock');
    statementId = locked.statementId;
  });
  return statementId;
}

/** بيكتب صف تصحيح موقوف كصف حقيقي محفوظ، مع تحكم كامل في التوقيت والرمز والحالة. */
async function seedBlocked(
  f: CommissionPlanFixture,
  seed: {
    statementId: string;
    companyId?: string;
    businessId?: string;
    employeeId?: string;
    sourcePeriod?: string;
    targetPeriod?: string;
    code?: 'NO_PLAN' | 'NO_SALARY';
    createdAt: string;
    resolvedAt?: string;
    id?: string;
  },
): Promise<string> {
  const id = seed.id ?? ids.newId();
  await f.h.owner`INSERT INTO commission_blocked_corrections(
    company_id,id,business_id,employee_id,source_period,code,first_event_id,target_period,
    target_statement_id,created_at,resolved_at,resolved_generation)
    VALUES (${seed.companyId ?? f.company},${id},${seed.businessId ?? f.business},
      ${seed.employeeId ?? f.employee},${seed.sourcePeriod ?? '2026-09'},
      ${seed.code ?? 'NO_PLAN'},${ids.newId()},${seed.targetPeriod ?? '2026-11'},
      ${seed.statementId},${seed.createdAt}::text::timestamptz,
      ${seed.resolvedAt ?? null}::text::timestamptz,
      ${seed.resolvedAt === undefined ? null : 1})`;
  return id;
}

/** نشاط تاني في نفس الشركة بموظفة وفرعه: صفوفه ما تظهرش في قائمة نشاط الهدف. */
async function otherBusinessScope(f: CommissionPlanFixture): Promise<{
  otherBusiness: string;
  otherBusinessBranch: string;
  otherBusinessEmployee: string;
}> {
  const { h } = f;
  const otherBusinessResponse = await h.send('POST', '/v1/businesses', {
    cookie: f.cookie,
    company: f.company,
    key: 'blocked-other-business',
    body: { vertical_type: 'salon', name_en: 'Blocked other business', timezone: 'Asia/Kuwait' },
  });
  const otherBusiness = otherBusinessResponse.body['id'] as string;
  const otherBranchResponse = await h.send('POST', `/v1/businesses/${otherBusiness}/branches`, {
    cookie: f.cookie,
    company: f.company,
    key: 'blocked-other-branch',
    body: { name_en: 'Blocked other branch' },
  });
  const otherBusinessBranch = otherBranchResponse.body['id'] as string;
  const otherBusinessEmployee = ids.newId();
  await h.owner`INSERT INTO employees(
    company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES (${f.company},${otherBusinessEmployee},${otherBusiness},${otherBusinessBranch},
      'Other business employee',${employeeNameMatchKey('Other business employee')},'staff','2026-01-01',2)`;
  return { otherBusiness, otherBusinessBranch, otherBusinessEmployee };
}

/** شركة تانية بنشاطها وفرعها وموظفتها: سلبي RLS على مستوى الـ API. */
async function foreignScope(
  f: CommissionPlanFixture,
): Promise<{ foreignCompany: string; foreignBusiness: string; foreignEmployee: string }> {
  const { h } = f;
  const foreignCompany = await h.onboard(f.cookie, 'Blocked foreign company');
  const foreignBusiness = ids.newId();
  const foreignBranch = ids.newId();
  const foreignEmployee = ids.newId();
  await h.owner`INSERT INTO businesses(company_id,id,name_en,vertical_type,timezone)
    VALUES (${foreignCompany},${foreignBusiness},'Blocked foreign business','salon','Asia/Kuwait')`;
  await h.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES (${foreignCompany},${foreignBranch},${foreignBusiness},'Blocked foreign branch')`;
  await h.owner`INSERT INTO employees(
    company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES (${foreignCompany},${foreignEmployee},${foreignBusiness},${foreignBranch},
      'Foreign employee',${employeeNameMatchKey('Foreign employee')},'staff','2026-01-01',1)`;
  return { foreignCompany, foreignBusiness, foreignEmployee };
}

async function blockedFixture(): Promise<BlockedScope> {
  const f = await commissionPlanVersionsFixture();
  const { otherBusiness, otherBusinessEmployee } = await otherBusinessScope(f);
  const { foreignCompany, foreignBusiness, foreignEmployee } = await foreignScope(f);
  return {
    f,
    otherBusiness,
    otherBusinessEmployee,
    foreignCompany,
    foreignBusiness,
    foreignEmployee,
  };
}

let fx: BlockedScope;
beforeEach(async () => {
  fx = await blockedFixture();
});
afterEach(async () => {
  await closeCommissionFixture(fx.f);
});

async function list(
  query = '',
  actor = fx.f.cookie,
  businessId = fx.f.business,
): Promise<{
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, unknown>;
}> {
  return fx.f.h.send('GET', `${listPath(businessId)}${query}`, {
    cookie: actor,
    company: fx.f.company,
  });
}

/** حساب الترتيب المتوقع في JavaScript: created_at تنازلي ثم id تنازلي — نفس مفتاح الـ SQL. */
function expectedOrder(
  rows: readonly { readonly createdAt: string; readonly id: string }[],
): string[] {
  return [...rows]
    .sort((a, b) =>
      a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? 1 : -1) : a.id < b.id ? 1 : -1,
    )
    .map((row) => row.id);
}

it('L1 the page projects the block identity only, with the open default and no cursor on the last page', async () => {
  const statementId = await statementFor(fx.f, fx.f.company, fx.f.business, '2026-11');
  const older = await seedBlocked(fx.f, {
    statementId,
    sourcePeriod: '2026-08',
    createdAt: '2026-11-01T08:00:00Z',
    code: 'NO_PLAN',
  });
  const newer = await seedBlocked(fx.f, {
    statementId,
    createdAt: '2026-11-02T08:00:00Z',
    code: 'NO_SALARY',
  });
  const response = await list('?limit=20');
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(Object.keys(response.body)).toEqual(['items', 'next_cursor']);
  const body = commissionBlockedCorrectionList.parse(response.body);
  expect(body.next_cursor).toBeNull();
  expect(body.items.map((item) => item.id)).toEqual(
    expectedOrder([
      { createdAt: '2026-11-01T08:00:00Z', id: older },
      { createdAt: '2026-11-02T08:00:00Z', id: newer },
    ]),
  );
  expect(body.items.map((item) => item.code)).toEqual(['NO_SALARY', 'NO_PLAN']);
  const only = body.items[0];
  expect(only).toBeDefined();
  expect(Object.keys(only ?? {}).sort()).toEqual([
    'code',
    'created_at',
    'employee_id',
    'id',
    'resolved_at',
    'source_period',
    'target_period',
  ]);
  expect(only?.employee_id).toBe(fx.f.employee);
  expect(only?.source_period).toBe('2026-09');
  expect(only?.target_period).toBe('2026-11');
  expect(only?.resolved_at).toBeNull();
});

it('L1 an empty business is a 200 page with no items and no cursor', async () => {
  await statementFor(fx.f, fx.f.company, fx.otherBusiness, '2026-11');
  const response = await list('', fx.f.cookie, fx.otherBusiness);
  expect(response.status).toBe(200);
  const body = commissionBlockedCorrectionList.parse(response.body);
  expect(body.items).toEqual([]);
  expect(body.next_cursor).toBeNull();
});

it('L3 three pages of equal created_at walk the ties once each by id DESC', async () => {
  const statementId = await statementFor(fx.f, fx.f.company, fx.f.business, '2026-11');
  const same = '2026-11-01T08:00:00Z';
  const seeded: { createdAt: string; id: string }[] = [];
  // شهر مصدر مختلف لكل صف: الفهرس الجزئي بيسمح بصف مفتوح واحد لكل موظفة وشهر.
  const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
  for (const month of months) {
    seeded.push({
      createdAt: same,
      id: await seedBlocked(fx.f, { statementId, sourcePeriod: month, createdAt: same }),
    });
  }
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 5; page += 1) {
    const q = cursor === null ? '?limit=2' : `?limit=2&cursor=${encodeURIComponent(cursor)}`;
    const response = await list(q);
    expect(response.status).toBe(200);
    const body = commissionBlockedCorrectionList.parse(response.body);
    seen.push(...body.items.map((item) => item.id));
    if (body.next_cursor === null) break;
    cursor = body.next_cursor;
  }
  expect(seen).toEqual(expectedOrder(seeded));
  expect(new Set(seen).size).toBe(seen.length);
});

it('L4 the status filter splits open from resolved and refuses an unknown status', async () => {
  const statementId = await statementFor(fx.f, fx.f.company, fx.f.business, '2026-11');
  const open = await seedBlocked(fx.f, { statementId, createdAt: '2026-11-01T08:00:00Z' });
  const resolved = await seedBlocked(fx.f, {
    statementId,
    createdAt: '2026-11-02T08:00:00Z',
    resolvedAt: '2026-11-05T08:00:00Z',
  });
  const defaulted = commissionBlockedCorrectionList.parse((await list()).body);
  expect(defaulted.items.map((item) => item.id)).toEqual([open]);
  expect(defaulted.items[0]?.resolved_at).toBeNull();
  const resolvedPage = commissionBlockedCorrectionList.parse((await list('?status=resolved')).body);
  expect(resolvedPage.items.map((item) => item.id)).toEqual([resolved]);
  expect(resolvedPage.items[0]?.resolved_at).toBe('2026-11-05T08:00:00.000Z');
  const whole = commissionBlockedCorrectionList.parse((await list('?status=all')).body);
  expect(whole.items.map((item) => item.id)).toEqual(
    expectedOrder([
      { createdAt: '2026-11-01T08:00:00Z', id: open },
      { createdAt: '2026-11-02T08:00:00Z', id: resolved },
    ]),
  );
  const bogus = await list('?status=bogus');
  expect([bogus.status, bogus.body['code']]).toEqual([400, 'VALIDATION_FAILED']);
});

it('L5 a member without the plan permission, a disabled feature and a foreign business are refused', async () => {
  const statementId = await statementFor(fx.f, fx.f.company, fx.f.business, '2026-11');
  await seedBlocked(fx.f, { statementId, createdAt: '2026-11-01T08:00:00Z' });
  const stranger = await memberWithoutPlanPermission(fx.f);
  const denied = await list('', stranger.cookie);
  expect([denied.status, denied.body['code']]).toEqual([403, 'FORBIDDEN']);
  await fx.f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES (${fx.f.company},'commissions',false,'Synthetic disabled',${fx.f.userId})`;
  const disabled = await list();
  expect([disabled.status, disabled.body['code']]).toEqual([403, 'FEATURE_DISABLED']);
  const missing = await list('', fx.f.cookie, ids.newId());
  expect([missing.status, missing.body['code']]).toEqual([403, 'FORBIDDEN']);
});

it('L5 the session company hint answers a headerless request, and no hint at all is refused', async () => {
  const statementId = await statementFor(fx.f, fx.f.company, fx.f.business, '2026-11');
  const seeded = await seedBlocked(fx.f, { statementId, createdAt: '2026-11-01T08:00:00Z' });
  await fx.f.h.owner`UPDATE session SET active_company_id=${fx.f.company} WHERE user_id=${fx.f.userId}`;
  const hinted = await fx.f.h.app.inject({
    method: 'GET',
    url: listPath(fx.f.business),
    headers: { cookie: fx.f.cookie },
  });
  expect(hinted.statusCode).toBe(200);
  const body = commissionBlockedCorrectionList.parse(hinted.json());
  expect(body.items.map((item) => item.id)).toEqual([seeded]);
  await fx.f.h.owner`UPDATE session SET active_company_id=NULL WHERE user_id=${fx.f.userId}`;
  const withoutHint = await fx.f.h.app.inject({
    method: 'GET',
    url: listPath(fx.f.business),
    headers: { cookie: fx.f.cookie },
  });
  expect([withoutHint.statusCode, (withoutHint.json() as { code?: string }).code]).toEqual([
    403,
    'FORBIDDEN',
  ]);
});

it('L6 rows of another business and of another tenant are never returned', async () => {
  const statementId = await statementFor(fx.f, fx.f.company, fx.f.business, '2026-11');
  const mine = await seedBlocked(fx.f, { statementId, createdAt: '2026-11-01T08:00:00Z' });
  const otherStatement = await statementFor(fx.f, fx.f.company, fx.otherBusiness, '2026-11');
  const otherBusinessRow = await seedBlocked(fx.f, {
    statementId: otherStatement,
    businessId: fx.otherBusiness,
    employeeId: fx.otherBusinessEmployee,
    createdAt: '2026-11-03T08:00:00Z',
  });
  const foreignStatement = await statementFor(
    fx.f,
    fx.foreignCompany,
    fx.foreignBusiness,
    '2026-11',
  );
  const foreignRow = await seedBlocked(fx.f, {
    statementId: foreignStatement,
    companyId: fx.foreignCompany,
    businessId: fx.foreignBusiness,
    employeeId: fx.foreignEmployee,
    createdAt: '2026-11-04T08:00:00Z',
  });
  const response = await list('?status=all&limit=100');
  expect(response.status).toBe(200);
  const body = commissionBlockedCorrectionList.parse(response.body);
  const listed = body.items.map((item) => item.id);
  expect(listed).toEqual([mine]);
  expect(listed).not.toContain(otherBusinessRow);
  expect(listed).not.toContain(foreignRow);
});

it('L5 a malformed cursor, and a real server-issued cursor under another filter or scope, are refused', async () => {
  const statementId = await statementFor(fx.f, fx.f.company, fx.f.business, '2026-11');
  await seedBlocked(fx.f, {
    statementId,
    sourcePeriod: '2026-08',
    createdAt: '2026-11-01T08:00:00Z',
  });
  await seedBlocked(fx.f, {
    statementId,
    sourcePeriod: '2026-09',
    createdAt: '2026-11-02T08:00:00Z',
  });
  await statementFor(fx.f, fx.f.company, fx.otherBusiness, '2026-11');
  const broken = await list('?cursor=not-a-cursor');
  expect([broken.status, broken.body['code']]).toEqual([400, 'VALIDATION_FAILED']);
  // مؤشر صالح صادر من السيرفر لصفحة مفتوحة مصرّح بيها: فلتر تاني بنفس النشاط رفض معروف.
  const first = commissionBlockedCorrectionList.parse((await list('?limit=1')).body);
  expect(first.next_cursor).not.toBeNull();
  const issued = encodeURIComponent(first.next_cursor as string);
  const crossedFilter = await list(`?limit=1&status=resolved&cursor=${issued}`);
  expect([crossedFilter.status, crossedFilter.body['code']]).toEqual([400, 'VALIDATION_FAILED']);
  const crossedScope = await list(`?limit=1&cursor=${issued}`, fx.f.cookie, fx.otherBusiness);
  expect([crossedScope.status, crossedScope.body['code']]).toEqual([400, 'VALIDATION_FAILED']);
});

it('the accountant system role opens the list like the plan screens', async () => {
  const statementId = await statementFor(fx.f, fx.f.company, fx.f.business, '2026-11');
  await seedBlocked(fx.f, { statementId, createdAt: '2026-11-01T08:00:00Z' });
  const email = 'blocked-accountant@example.test';
  const cookie = await fx.f.h.signedInOperator(email);
  const [user] = await fx.f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const role = SYSTEM_ROLES.find((entry) => entry.code === 'accountant')?.id as string;
  await fx.f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    VALUES (${fx.f.company},${ids.newId()},${user?.['id'] as string},${role},'global','BUSINESS',${fx.f.business},'2026-01-01')`;
  const response = await list('', cookie);
  expect(response.status).toBe(200);
  const body = commissionBlockedCorrectionList.parse(response.body);
  expect(body.items).toHaveLength(1);
});
