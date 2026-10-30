import { employeeNameMatchKey } from '@pospay/domain';
import { createDatabase, lockStatementPeriods, type StatementStatus } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import type { CreateCommissionPlanVersionInput } from '@pospay/contracts';

import {
  businessCalendar,
  lockEmployeeForUpdate,
  readCommissionPlanAccess,
  startHarness,
} from '../../../../test/harness.ts';
import { walkCommissionStatement } from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import { listCommissionPlanVersions } from '../queries/commission-plan-versions.query.ts';

export const COMMISSION_NOW = new Date('2026-10-30T12:00:00.000Z');
export const ids = systemUuidV7();

export function commissionPlanInput(
  effectiveFrom = '2026-10-30',
): CreateCommissionPlanVersionInput {
  return {
    effective_from: effectiveFrom,
    whole_period: false,
    base: { enabled: false },
    tiers: {
      enabled: true,
      mode: 'MARGINAL',
      accumulator: 'AMOUNT',
      steps: [
        {
          from: { kind: 'SALARY_MULTIPLE', value: '2.00' },
          calc: { kind: 'PCT', bps: 500 },
        },
      ],
    },
    package_sale: { enabled: false },
  };
}

type CommissionHarness = Awaited<ReturnType<typeof startHarness>>;

async function seedCommissionBusiness(h: CommissionHarness, cookie: string, company: string) {
  const businessResponse = await h.send('POST', '/v1/businesses', {
    cookie,
    company,
    key: 'commission-plan-business',
    body: { vertical_type: 'salon', name_en: 'Commission salon', timezone: 'Asia/Kuwait' },
  });
  const business = businessResponse.body['id'] as string;
  await h.owner`UPDATE businesses SET created_at='2026-01-01T00:00:00.000Z'
    WHERE company_id=${company} AND id=${business}`;
  const branchResponse = await h.send('POST', `/v1/businesses/${business}/branches`, {
    cookie,
    company,
    key: 'commission-plan-branch',
    body: { name_en: 'Commission branch' },
  });
  return { business, branch: branchResponse.body['id'] as string };
}

export async function commissionPlanVersionsFixture() {
  let now = COMMISSION_NOW;
  const h = await startHarness({ commissionsClock: { now: () => now } });
  const cookie = await h.signedInOperator('commission-plan-owner@example.test');
  const company = await h.onboard(cookie, 'Commission plan employer');
  const { business, branch } = await seedCommissionBusiness(h, cookie, company);
  const [owner] =
    await h.owner`SELECT id FROM "user" WHERE email='commission-plan-owner@example.test'`;
  const userId = owner?.['id'] as string;
  const employee = ids.newId();
  await h.owner`INSERT INTO employees(
    company_id,id,business_id,primary_branch_id,user_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES (${company},${employee},${business},${branch},${userId},'Sarah',${employeeNameMatchKey('Sarah')},'staff','2026-01-01',1)`;
  const db = createDatabase({ url: h.urls.app, ids });
  const readers = {
    businessCalendar,
    employeeLock: lockEmployeeForUpdate,
    access: readCommissionPlanAccess,
  };
  return {
    h,
    db,
    cookie,
    company,
    business,
    branch,
    employee,
    userId,
    setNow: (value: Date) => {
      now = value;
    },
    readers,
    tenant: { company, business, branch, employee, membership: '' },
    post: (body: object, key: string, employeeId = employee, actor = cookie) =>
      h.send('POST', commissionPlanPath(business, employeeId), {
        cookie: actor,
        company,
        key,
        body,
      }),
    get: (query = '', employeeId = employee, actor = cookie) =>
      h.send('GET', `${commissionPlanPath(business, employeeId)}${query}`, {
        cookie: actor,
        company,
      }),
    list: (query: { limit: number; cursor?: number }) =>
      db.withTenant(company, (tx) =>
        listCommissionPlanVersions(tx, company, business, employee, query),
      ),
  };
}

export type CommissionPlanFixture = Awaited<ReturnType<typeof commissionPlanVersionsFixture>>;

export function commissionPlanPath(business: string, employee: string): string {
  return `/v1/businesses/${business}/employees/${employee}/commission-plan-versions`;
}

export async function setCommissionStatement(
  f: CommissionPlanFixture,
  period: string,
  status: StatementStatus,
): Promise<void> {
  if (status === 'DRAFT') {
    await f.db.withTenant(f.company, (tx) =>
      lockStatementPeriods(tx, { businessId: f.business, periods: [period], ids }),
    );
    return;
  }
  await walkCommissionStatement(f.db, {
    tenant: { ...f.tenant, membership: await ownerMembership(f) },
    reviewer: f.userId,
    period,
    ids,
    to: status,
  });
}

async function ownerMembership(f: CommissionPlanFixture): Promise<string> {
  const [row] = await f.h.owner`SELECT id FROM memberships
    WHERE company_id=${f.company} AND user_id=${f.userId} LIMIT 1`;
  return row?.['id'] as string;
}

export async function versionAndAuditCounts(f: CommissionPlanFixture): Promise<number[]> {
  const [versions] = await f.h.owner`SELECT count(*)::int AS count FROM commission_plan_versions`;
  const [audits] = await f.h.owner`SELECT count(*)::int AS count FROM audit_log
    WHERE action='commission_plan.version_created'`;
  return [versions?.['count'] as number, audits?.['count'] as number];
}

export async function memberWithoutPlanPermission(
  f: CommissionPlanFixture,
): Promise<{ cookie: string; userId: string; membershipId: string }> {
  const email = 'commission-plan-without-permission@example.test';
  const cookie = await f.h.signedInOperator(email);
  const [user] = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const userId = user?.['id'] as string;
  const role = ids.newId();
  const membershipId = ids.newId();
  await f.h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${role},${f.company},'commission_plan_reader','Commission plan reader')`;
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${f.company},${membershipId},${userId},${role},${f.company},'BUSINESS',${f.business})`;
  return { cookie, userId, membershipId };
}

export async function approvedDeviceToken(f: CommissionPlanFixture): Promise<string> {
  const pairing = await f.h.send('POST', `/v1/branches/${f.branch}/devices/pairing-code`, {
    cookie: f.cookie,
    company: f.company,
  });
  const registered = await f.h.app.inject({
    method: 'POST',
    url: '/v1/devices/register',
    payload: { pairing_code: pairing.body['code'], label: 'Commission device' },
  });
  const device = registered.json() as { device_id: string; claim_secret: string };
  await f.h.send('POST', `/v1/branches/${f.branch}/devices/${device.device_id}/approve`, {
    cookie: f.cookie,
    company: f.company,
  });
  const claimed = await f.h.app.inject({
    method: 'POST',
    url: '/v1/devices/claim',
    payload: {
      company_id: f.company,
      device_id: device.device_id,
      claim_secret: device.claim_secret,
    },
  });
  return (claimed.json() as { device_token: string }).device_token;
}

export async function closeCommissionFixture(f: CommissionPlanFixture): Promise<void> {
  await f.db.close();
  await f.h.close();
}
