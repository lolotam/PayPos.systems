import { afterAll, beforeAll, expect, it } from 'vitest';
import { ownWorkReads } from '../orders.module.ts';
import { readOwnServiceLines } from '../queries/own-service-lines.query.ts';
import type { OwnWorkContext, OwnWorkReads } from '../queries/own-work-context.ts';
import {
  ids,
  must,
  recordVisit,
  tipFixture,
  type TipFixture,
} from '../../../../test/session-tips.fixture.ts';

let f: TipFixture;
const now = new Date('2026-10-15T08:00:00Z');
type ScopedLine = { context: OwnWorkContext; employeeId: string; lineId: string };
let home: ScopedLine;
const foreign: Partial<Record<'business' | 'tenant', ScopedLine>> = {};

beforeAll(async () => {
  f = await tipFixture();
  await f.linkEmployee(must(f.employees[0]), f.ownerId);
  const visit = await recordVisit(f);
  home = {
    context: { companyId: f.company, businessId: f.business, userId: f.ownerId },
    employeeId: must(f.employees[0]),
    lineId: must(visit.lineIds[0]),
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
  return {
    context: { companyId, businessId, userId: f.ownerId },
    employeeId,
    lineId: must(recorded.session.lines[0]).id,
  };
}

function readScope(scope: ScopedLine, query: unknown = {}, reads: OwnWorkReads = ownWorkReads) {
  return f.db.withTenant(
    scope.context.companyId,
    (tx) => readOwnServiceLines(tx, scope.context, query, now, reads),
    { userId: scope.context.userId },
  );
}

it.each(['business', 'tenant'] as const)(
  'excludes live %s rows and uniformly refuses their cursor after proving both callers eligible',
  async (kind) => {
    const outside = must(foreign[kind]);
    const ownPage = await readScope(home);
    const foreignPage = await readScope(outside);
    expect(ownPage.items.map((line) => line.line_id)).toContain(home.lineId);
    expect(foreignPage.items.map((line) => line.line_id)).toEqual([outside.lineId]);
    expect(ownPage.items.map((line) => line.line_id)).not.toContain(outside.lineId);
    expect(foreignPage.items.map((line) => line.line_id)).not.toContain(home.lineId);
    await expect(readScope(home, { cursor: outside.lineId })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });
    await expect(readScope(outside, { cursor: home.lineId })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });
  },
);

it('marks only a next-day appended line late and hides both late flags with date', async () => {
  f.setAt(new Date('2026-10-14T09:00:00Z'));
  try {
    const original = await recordVisit(f);
    f.setAt(now);
    const appended = await f.append.execute({
      ...f.context(),
      sessionId: original.sessionId,
      input: { lines: [f.line()] },
    });
    const originalId = must(original.lineIds[0]);
    const appendedId = must(appended.added_lines[0]).id;
    const visible = await readScope(home);
    expect(visible.items.find((line) => line.line_id === originalId)?.late).toBe(false);
    expect(visible.items.find((line) => line.line_id === appendedId)?.late).toBe(true);
    const hidden = await readScope(home, {}, { ...ownWorkReads, allowed: async () => new Set() });
    for (const lineId of [originalId, appendedId]) {
      const line = hidden.items.find((row) => row.line_id === lineId);
      expect(line).toBeDefined();
      expect(line).not.toHaveProperty('late');
      expect(line).not.toHaveProperty('date');
    }
  } finally {
    f.setAt(now);
  }
});
