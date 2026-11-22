import { afterAll, beforeAll, expect, it } from 'vitest';
import { ownWorkReads } from '../orders.module.ts';
import { readOwnServiceLines } from '../queries/own-service-lines.query.ts';
import type { OwnWorkContext } from '../queries/own-work-context.ts';
import {
  ids,
  must,
  recordVisit,
  tipFixture,
  type TipFixture,
} from '../../../../test/session-tips.fixture.ts';

// البند 6 (RLS هي حد المستأجر): قراءة موجبة حقيقية في النطاق الأجنبي قبل كل تأكيد استبعاد.
let f: TipFixture;
const now = new Date('2026-10-15T08:00:00Z');
type Scoped = { context: OwnWorkContext; lineId: string };
let home: Scoped;
const foreign: Partial<Record<'business' | 'tenant', Scoped>> = {};

beforeAll(async () => {
  f = await tipFixture();
  await f.linkEmployee(must(f.employees[0]), f.ownerId);
  const visit = await recordVisit(f);
  home = {
    context: { companyId: f.company, businessId: f.business, userId: f.ownerId },
    lineId: must(visit.lineIds[0]),
  };
  foreign.business = await seedOtherScope('business');
  foreign.tenant = await seedOtherScope('tenant');
});
afterAll(async () => {
  await f?.close();
});

async function seedOtherScope(kind: 'business' | 'tenant'): Promise<Scoped> {
  const companyId = kind === 'business' ? f.company : f.otherCompany;
  const businessId = kind === 'business' ? f.secondBusiness : f.foreignBusiness;
  const branchId = kind === 'business' ? f.secondBranch : f.foreignBranch;
  const employeeId = ids.newId(),
    serviceId = ids.newId(),
    customerId = kind === 'business' ? f.customer : ids.newId(),
    recorderMembershipId = ids.newId();
  if (kind === 'tenant')
    await f.h.owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
      VALUES(${companyId},${customerId},'Synthetic foreign customer','+999999998124','en',now(),now())`;
  await f.h.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES(${companyId},${serviceId},${businessId},'Synthetic foreign service','25.000','ZERO')`;
  await f.h
    .owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,user_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${companyId},${employeeId},${businessId},${branchId},${f.ownerId},'Synthetic foreign employee','synthetic foreign employee','staff','2026-01-01',201)`;
  await f.h
    .owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${companyId},${ids.newId()},${businessId},${employeeId},${branchId},'2026-01-01')`;
  for (const [userId, membershipId] of [
    [f.userId, recorderMembershipId],
    [f.ownerId, ids.newId()],
  ] as const)
    await f.h
      .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at,limit_bps)
      SELECT ${companyId},${membershipId},${userId},role_id,role_owner_key,'BRANCH',${branchId},'2026-01-01',limit_bps
      FROM memberships WHERE company_id=${f.company} AND id=${f.membership}`;
  const recorded = await f.create.execute({
    ...f.context(),
    companyId,
    businessId,
    branchId,
    input: {
      customer_id: customerId,
      occurred_at: '2026-10-14T08:00:00.000Z',
      recorder_membership_id: recorderMembershipId,
      lines: [{ ...f.line(serviceId), performers: [{ employee_id: employeeId }] }],
    },
  });
  return {
    context: { companyId, businessId, userId: f.ownerId },
    lineId: must(recorded.session.lines[0]).id,
  };
}

const readScope = (scope: Scoped, query: unknown = {}, tenant = scope.context.companyId) =>
  f.db.withTenant(
    tenant,
    (tx) => readOwnServiceLines(tx, scope.context, query, now, ownWorkReads),
    { userId: f.ownerId, readOnly: true },
  );
const lineIds = (page: { items: { line_id: string }[] }) => page.items.map((l) => l.line_id);

it.each(['business', 'tenant'] as const)(
  'a %s outside the session never leaks lines, cursors or scope keys',
  async (kind) => {
    const outside = must(foreign[kind]);
    expect(lineIds(await readScope(home))).toContain(home.lineId);
    expect(lineIds(await readScope(outside))).toEqual([outside.lineId]);
    expect(lineIds(await readScope(home))).not.toContain(outside.lineId);
    await expect(readScope(home, { cursor: outside.lineId })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    for (const key of ['employee_id', 'business_id', 'company_id', 'branch_id'])
      await expect(readScope(home, { [key]: outside.lineId })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    if (kind === 'tenant')
      await expect(readScope(outside, {}, home.context.companyId)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
  },
);
