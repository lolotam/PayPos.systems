import { afterAll, beforeAll, expect, it } from 'vitest';
import { ownWorkReads } from '../orders.module.ts';
import { readOwnTips } from '../queries/own-tips.query.ts';
import type { OwnWorkContext, OwnWorkReads } from '../queries/own-work-context.ts';
import {
  ids,
  must,
  recordVisit,
  runTips,
  tip,
  tipInput,
  tipFixture,
  type TipFixture,
} from '../../../../test/session-tips.fixture.ts';

let f: TipFixture;
const now = new Date('2026-10-15T08:00:00Z');
type ScopedLine = { context: OwnWorkContext; employeeId: string };
let home: ScopedLine;
const foreign: Partial<Record<'business' | 'tenant', ScopedLine>> = {};

beforeAll(async () => {
  f = await tipFixture();
  await f.linkEmployee(must(f.employees[0]), f.ownerId);
  const visit = await recordVisit(f);
  await runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.500')]));
  home = {
    context: { companyId: f.company, businessId: f.business, userId: f.ownerId },
    employeeId: must(f.employees[0]),
  };
  foreign.business = await seedOtherScope('business');
  foreign.tenant = await seedOtherScope('tenant');
});
afterAll(async () => {
  await f?.close();
});

async function seedOtherScope(kind: 'business' | 'tenant'): Promise<ScopedLine> {
  const companyId = kind === 'business' ? f.company : f.otherCompany;
  const businessId = kind === 'business' ? f.secondBusiness : f.foreignBusiness;
  const branchId = kind === 'business' ? f.secondBranch : f.foreignBranch;
  const employeeId = ids.newId(),
    serviceId = ids.newId();
  const customerId = kind === 'business' ? f.customer : ids.newId();
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
  const recorderMembershipId = ids.newId();
  for (const [userId, membershipId] of [
    [f.userId, recorderMembershipId],
    [f.ownerId, ids.newId()],
  ])
    await f.h
      .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at,limit_bps)
      SELECT ${companyId},${must(membershipId)},${must(userId)},role_id,role_owner_key,'BRANCH',${branchId},'2026-01-01',limit_bps
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
  await runTips(
    f,
    recorded.session.id,
    tipInput([{ employee_id: employeeId, method: 'CARD', amount: '9.000' }], {
      recorder_membership_id: recorderMembershipId,
    }),
    { companyId, businessId, branchId },
  );
  return {
    context: { companyId, businessId, userId: f.ownerId },
    employeeId,
  };
}

function readScope(scope: ScopedLine, query: unknown = {}, reads: OwnWorkReads = ownWorkReads) {
  return f.db.withTenant(
    scope.context.companyId,
    (tx) => readOwnTips(tx, scope.context, query, now, reads),
    { userId: scope.context.userId },
  );
}

it.each(['business', 'tenant'] as const)(
  'isolates eligible %s tips after positive reads in both scopes',
  async (kind) => {
    const outside = must(foreign[kind]);
    expect(await readScope(home)).toEqual({
      month: '2026-10',
      status: 'VISIBLE',
      total_cash: '1.500',
      total_card: '0.000',
    });
    expect(await readScope(outside)).toEqual({
      month: '2026-10',
      status: 'VISIBLE',
      total_cash: '0.000',
      total_card: '9.000',
    });
    for (const key of ['employee_id', 'business_id', 'company_id', 'branch_id']) {
      await expect(readScope(home, { [key]: outside.employeeId })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }
    if (kind === 'tenant')
      await expect(
        f.db.withTenant(home.context.companyId, (tx) =>
          readOwnTips(tx, outside.context, {}, now, ownWorkReads),
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    else
      await expect(
        f.db.withTenant(f.company, (tx) =>
          readOwnTips(tx, { ...home.context, branchId: f.secondBranch }, {}, now, ownWorkReads),
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  },
);

it('current device branch proves authority without narrowing historical tips after a transfer', async () => {
  const branchId = ids.newId();
  await f.h
    .owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.company},${branchId},${f.business},'Synthetic transfer branch')`;
  await f.h
    .owner`UPDATE employee_branches SET "to"='2026-10-15' WHERE company_id=${f.company} AND employee_id=${home.employeeId}`;
  await f.h
    .owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from") VALUES(${f.company},${ids.newId()},${f.business},${home.employeeId},${branchId},'2026-10-15')`;
  await f.h
    .owner`UPDATE branches SET is_active=false WHERE company_id=${f.company} AND id=${f.branch}`;
  try {
    const moved = { ...home.context, branchId };
    const result = await f.db.withTenant(f.company, (tx) =>
      readOwnTips(tx, moved, {}, now, ownWorkReads),
    );
    expect(result).toEqual({
      month: '2026-10',
      status: 'VISIBLE',
      total_cash: '1.500',
      total_card: '0.000',
    });
    await expect(
      f.db.withTenant(f.company, (tx) =>
        readOwnTips(tx, { ...home.context, branchId: f.branch }, {}, now, ownWorkReads),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(readScope(home, { month: '2026-08' })).rejects.toMatchObject({
      code: 'MY_PERIOD_OUT_OF_RANGE',
    });
    await expect(readScope(home, { month: '2026-11' })).rejects.toMatchObject({
      code: 'MY_PERIOD_OUT_OF_RANGE',
    });
  } finally {
    await f.h
      .owner`UPDATE branches SET is_active=true WHERE company_id=${f.company} AND id=${f.branch}`;
  }
});
