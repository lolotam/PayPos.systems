import { systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../client.ts';
import {
  cleanStatementAlertRoles,
  StatementAlertRolesRoleRefusedError,
} from '../data-steps/statement-alert-roles.ts';

let testDb: TestDatabase, owner: postgres.Sql, app: Database;
const ids = systemUuidV7();
const { A, B } = TENANT;
const REVIEW = 'STATEMENT_AWAITING_REVIEW';
const APPROVAL = 'STATEMENT_AWAITING_APPROVAL';

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO "user" (id,name,email) VALUES (${USER},'Synthetic user','alerts-486@example.test')
    ON CONFLICT DO NOTHING`;
  app = createDatabase({ url: testDb.appUrl, ids, maxConnections: 1 });
});
beforeEach(async () => {
  await owner`ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_statement_roles`;
  await owner`DELETE FROM audit_log`;
  await owner`DELETE FROM alert_rules`;
});
afterAll(async () => {
  await app?.close();
  await owner?.end();
  await testDb?.drop();
});

type Tenant = (typeof TENANT)['A' | 'B'];

async function insertRule(
  tenant: Tenant,
  kind: string,
  roles: string[],
  branch: string | null = null,
): Promise<string> {
  const id = ids.newId();
  await owner`INSERT INTO alert_rules(company_id,id,business_id,branch_id,kind,enabled,recipient_roles,channels,
    delay_minutes,lead_minutes,updated_by,revision)
    VALUES(${tenant.company},${id},${tenant.business},${branch},${kind},true,${owner.array(roles)}::text[],
    ${owner.array(['IN_APP'])}::text[],${kind === 'SHIFT_NOT_CLOCKED_IN' ? 20 : null},null,${USER},1)`;
  return id;
}

async function ruleOf(id: string) {
  const [row] = await owner<{ recipient_roles: string[]; revision: number }[]>`
    SELECT recipient_roles, revision FROM alert_rules WHERE id = ${id}`;
  return row;
}

const auditRows = () =>
  owner<
    {
      company_id: string;
      actor_user_id: string | null;
      entity_id: string;
      action: string;
      before: unknown;
      after: unknown;
    }[]
  >`SELECT company_id, actor_user_id, entity_id, action, before, after FROM audit_log ORDER BY at, id`;

it('removes branch_manager from both statement kinds and keeps every other field', async () => {
  const approval = await insertRule(A, APPROVAL, ['owner', 'branch_manager']);
  const review = await insertRule(A, REVIEW, ['branch_manager', 'general_manager']);
  const alone = await insertRule(A, APPROVAL, ['branch_manager'], A.branch);
  const counts = await cleanStatementAlertRoles(owner, app, ids);
  expect(counts).toEqual({ companies: 2, read: 3, cleaned: 3 });
  expect(await ruleOf(approval)).toEqual({ recipient_roles: ['owner'], revision: 2 });
  expect(await ruleOf(review)).toEqual({ recipient_roles: ['general_manager'], revision: 2 });
  expect(await ruleOf(alone)).toEqual({ recipient_roles: [], revision: 2 });
  const [kept] =
    await owner`SELECT enabled, channels, updated_by FROM alert_rules WHERE id = ${alone}`;
  expect(kept).toMatchObject({ enabled: true, channels: ['IN_APP'], updated_by: USER });
});

it('leaves a clean rule, an empty rule and every other kind exactly as they were', async () => {
  const clean = await insertRule(A, APPROVAL, ['owner']);
  const empty = await insertRule(A, REVIEW, []);
  const other = await insertRule(A, 'SHIFT_NOT_CLOCKED_IN', ['owner', 'branch_manager']);
  const counts = await cleanStatementAlertRoles(owner, app, ids);
  expect(counts).toEqual({ companies: 2, read: 0, cleaned: 0 });
  expect(await ruleOf(clean)).toEqual({ recipient_roles: ['owner'], revision: 1 });
  expect(await ruleOf(empty)).toEqual({ recipient_roles: [], revision: 1 });
  expect(await ruleOf(other)).toEqual({
    recipient_roles: ['owner', 'branch_manager'],
    revision: 1,
  });
  expect(await auditRows()).toEqual([]);
});

it('writes one system audit entry per changed rule, in that rule company, with before and after', async () => {
  await insertRule(A, APPROVAL, ['owner', 'branch_manager']);
  await insertRule(A, REVIEW, ['branch_manager'], A.branch);
  await cleanStatementAlertRoles(owner, app, ids);
  const rows = await auditRows();
  expect(rows).toHaveLength(2);
  for (const row of rows)
    expect(row).toMatchObject({
      company_id: A.company,
      actor_user_id: null,
      action: 'alert_rule.statement_role_removed',
    });
  const business = rows.find((row) => row.entity_id === A.business);
  expect(business?.before).toMatchObject({
    kind: APPROVAL,
    rule: { recipient_roles: ['owner', 'branch_manager'], revision: 1 },
  });
  expect(business?.after).toMatchObject({
    kind: APPROVAL,
    rule: { recipient_roles: ['owner'], revision: 2 },
  });
  expect(rows.some((row) => row.entity_id === A.branch)).toBe(true);
});

it('is idempotent: a second run changes nothing and writes nothing', async () => {
  const id = await insertRule(A, APPROVAL, ['owner', 'branch_manager']);
  await cleanStatementAlertRoles(owner, app, ids);
  const first = await auditRows();
  const second = await cleanStatementAlertRoles(owner, app, ids);
  expect(second).toEqual({ companies: 2, read: 0, cleaned: 0 });
  expect(await ruleOf(id)).toEqual({ recipient_roles: ['owner'], revision: 2 });
  expect(await auditRows()).toEqual(first);
});

it('works one tenant at a time: each company is cleaned and audited in its own scope only', async () => {
  const a = await insertRule(A, APPROVAL, ['branch_manager', 'owner']);
  const b = await insertRule(B, REVIEW, ['branch_manager', 'owner']);
  const untouched = await insertRule(B, 'SHIFT_NOT_CLOCKED_IN', ['branch_manager']);
  await cleanStatementAlertRoles(owner, app, ids);
  expect(await ruleOf(a)).toEqual({ recipient_roles: ['owner'], revision: 2 });
  expect(await ruleOf(b)).toEqual({ recipient_roles: ['owner'], revision: 2 });
  expect(await ruleOf(untouched)).toEqual({ recipient_roles: ['branch_manager'], revision: 1 });
  const rows = await auditRows();
  expect(rows.map((row) => row.company_id).sort()).toEqual([A.company, B.company].sort());
});

it('refuses a migration role with no isolation bypass before reading anything', async () => {
  const restricted = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    await expect(cleanStatementAlertRoles(restricted, app, ids)).rejects.toBeInstanceOf(
      StatementAlertRolesRoleRefusedError,
    );
  } finally {
    await restricted.end();
  }
});
