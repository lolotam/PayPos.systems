import { serviceSessionCapabilities } from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ordersCapabilitiesQuery } from '../orders.module.ts';
import { serviceSessionCapabilityClockStatement } from '../queries/service-session-capabilities.query.ts';
import { ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
beforeAll(async () => {
  f = await sessionFixture();
});
afterAll(async () => {
  await f?.close();
});

const home = () => `${f.base}/capabilities`;
const readHttp = (cookie = f.ownerCookie, base = home()) =>
  f.h.send('GET', base, { cookie, company: f.company });

async function role(code: string, scope = 'BRANCH', scopeId = f.branch) {
  await f.h
    .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.membership}`;
  const roleId = must(SYSTEM_ROLES.find((row) => row.code === code)).id;
  await f.h
    .owner`UPDATE memberships SET role_id=${roleId},scope_type=${scope},scope_id=${scopeId},ends_at=NULL
    WHERE company_id=${f.company} AND id=${f.membership}`;
}

async function grant(permission: string, effect: string, scopeType: string, scopeId: string) {
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,expires_at,reason,granted_by)
    VALUES(${f.company},${ids.newId()},${f.membership},${permission},${effect},${scopeType},${scopeId},null,'Synthetic cancel capability',${f.ownerId})`;
}

async function expectFlag(cookie: string, flag: boolean, base = home()) {
  const response = await readHttp(cookie, base);
  expect(response.status).toBe(200);
  expect(serviceSessionCapabilities.parse(response.body).can_cancel_lines).toBe(flag);
}

async function expectFlags(
  cookie: string,
  flags: { cancel: boolean; change: boolean },
  base = home(),
) {
  const response = await readHttp(cookie, base);
  expect(response.status).toBe(200);
  expect(serviceSessionCapabilities.parse(response.body)).toEqual({
    can_cancel_lines: flags.cancel,
    can_change_performers: flags.change,
  });
}

it('returns can_cancel_lines true for a holder and the query shape', async () => {
  await expectFlag(f.ownerCookie, true);
  const shape = await ordersCapabilitiesQuery(f.db).execute({ ...f.context(), userId: f.ownerId });
  expect(shape).toEqual({ can_cancel_lines: true, can_change_performers: true });
});

it('returns false when the day reader has no cancel permission', async () => {
  await role('staff');
  await grant('read:service-sessions:branch', 'ALLOW', 'COMPANY', f.company);
  await expectFlag(f.cookie, false);
  const shape = await ordersCapabilitiesQuery(f.db).execute({ ...f.context(), userId: f.userId });
  expect(shape).toEqual({ can_cancel_lines: false, can_change_performers: false });
});

it('returns false when cancel is denied on the branch', async () => {
  await role('branch_manager');
  await grant('cancel:service-lines:branch', 'DENY', 'BRANCH', f.branch);
  await expectFlag(f.cookie, false);
});

it('returns false for another branch while the home branch stays true', async () => {
  await role('staff');
  await grant('read:service-sessions:branch', 'ALLOW', 'COMPANY', f.company);
  await grant('cancel:service-lines:branch', 'ALLOW', 'BRANCH', f.branch);
  await expectFlag(f.cookie, true);
  const other = `/v1/businesses/${f.secondBusiness}/branches/${f.secondBranch}/service-sessions/capabilities`;
  await expectFlag(f.cookie, false, other);
});

it('returns can_change_performers from change:service-line-performers:branch alone (PP-19.2)', async () => {
  await role('staff');
  await grant('read:service-sessions:branch', 'ALLOW', 'COMPANY', f.company);
  await expectFlags(f.cookie, { cancel: false, change: false });
  await grant('change:service-line-performers:branch', 'ALLOW', 'BRANCH', f.branch);
  await expectFlags(f.cookie, { cancel: false, change: true });
  const other = `/v1/businesses/${f.secondBusiness}/branches/${f.secondBranch}/service-sessions/capabilities`;
  await expectFlags(f.cookie, { cancel: false, change: false }, other);
});

it('returns can_change_performers false when change is denied while cancel stays true', async () => {
  await role('branch_manager');
  await expectFlags(f.cookie, { cancel: true, change: true });
  await grant('change:service-line-performers:branch', 'DENY', 'BRANCH', f.branch);
  await expectFlags(f.cookie, { cancel: true, change: false });
});

it('keeps a disabled orders feature as FEATURE_DISABLED', async () => {
  await f.h
    .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'orders',false,'Synthetic capability feature',${f.ownerId})`;
  try {
    const response = await readHttp();
    expect(response.status).toBe(403);
    expect(response.body['code']).toBe('FEATURE_DISABLED');
    await expect(
      ordersCapabilitiesQuery(f.db).execute({ ...f.context(), userId: f.ownerId }),
    ).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
  }
});

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  Plans?: PlanNode[];
}
const planNodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(planNodes)];

it('plans the capability clock without a sequential scan', async () => {
  await f.db.withTenant(
    f.company,
    async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan=off`);
      const rows = await tx.execute<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
        sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${serviceSessionCapabilityClockStatement()}`,
      );
      const plan = planNodes(must(must(rows[0])['QUERY PLAN'][0]).Plan);
      expect(plan.some((node) => node['Node Type'] === 'Result')).toBe(true);
      expect(plan.some((node) => node['Node Type'] === 'Seq Scan')).toBe(false);
    },
    { userId: f.ownerId },
  );
});

// FOR SHARE لا يتعارض مع FOR UPDATE؛ EXCLUSIVE هو اللي يثبت إن القراءة ما أخدتش قفل الشركة.
it('does not wait on an exclusive company-table lock', async () => {
  let release!: () => void;
  const released = new Promise<void>((done) => {
    release = done;
  });
  let held!: () => void;
  const holding = new Promise<void>((done) => {
    held = done;
  });
  const holder = f.h.owner.begin(async (tx) => {
    await tx`LOCK TABLE companies IN EXCLUSIVE MODE`;
    held();
    await released;
  });
  let request: ReturnType<typeof readHttp> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await holding;
    request = readHttp();
    const response = await Promise.race([
      request,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('CAPABILITY_BLOCKED_ON_COMPANY_LOCK')), 1_500);
      }),
    ]);
    expect(response.status).toBe(200);
    expect(serviceSessionCapabilities.parse(response.body).can_cancel_lines).toBe(true);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    release();
    await holder;
    await request;
  }
});
