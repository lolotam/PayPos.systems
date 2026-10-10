import { createAttendanceDeviceRefusals } from '../persistence/attendance-device-refusals.ts';
import { employeeNameMatchKey } from '@pospay/domain';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { personalFixture, personalOrigin } from '../../../../test/personal-staff.fixture.ts';
import { testAuthenticator } from '../../../../../../packages/auth/src/__tests__/webauthn.fixture.ts';
import { present } from '../../../../../../packages/db/test/present.ts';
import { createPasskeyTransactions } from '../persistence/passkey-transactions.ts';
import { EnrolPasskey, type PasskeyScope } from '../use-cases/enrol-passkey/enrol-passkey.ts';
import {
  activePasskeyIds,
  activePasskeyStatement,
} from '../queries/active-passkey-bindings.query.ts';

let f: Awaited<ReturnType<typeof personalFixture>>;
let activeCredentialId: string;
let activePasskeyId: string;
beforeAll(async () => {
  f = await personalFixture();
});
afterAll(async () => {
  await f?.close();
});
const scope = (): PasskeyScope => ({
  userId: f.userId,
  sessionId: f.ids.newId(),
  companyId: f.companyId,
  businessId: f.businessId,
  employeeId: f.employeeId,
});
const enrollment = () =>
  new EnrolPasskey(
    f.auth.passkeys,
    createPasskeyTransactions(f.database, f.ids),
    f.ids,
    {
      now: () => new Date(),
    },
    createAttendanceDeviceRefusals(f.database, f.ids, () => undefined),
  );

it('binding rollback permits the same authenticator to retry with a fresh credential; only the new credential is bound', async () => {
  const requestScope = scope();
  const device = testAuthenticator();
  const generated = await f.auth.passkeys.enrollmentOptions(requestScope);
  const first = device.registerNewCredential(generated.options, personalOrigin, 'localhost');
  await expect(failedBinding().execute(requestScope, generated.challengeId, first)).rejects.toThrow(
    'PASSKEY_BINDING_PERSISTENCE_FAILED',
  );
  const [orphan] = await f.owner`SELECT id FROM passkey WHERE user_id=${f.userId}`;
  expect(orphan).toBeDefined();
  expect(await f.owner`SELECT id FROM employee_passkeys`).toHaveLength(0);
  expect(await f.owner`SELECT id FROM outbox WHERE aggregate_id=${f.employeeId}`).toHaveLength(0);
  expect(
    await f.owner`SELECT id FROM audit_log WHERE after->>'employee_id'=${f.employeeId}`,
  ).toHaveLength(0);
  const retry = await f.auth.passkeys.enrollmentOptions(requestScope);
  expect(retry.options.excludeCredentials).toEqual([]);
  const second = device.registerNewCredential(retry.options, personalOrigin, 'localhost');
  expect(second.id).not.toBe(first.id);
  const result = await enrollment().execute(requestScope, retry.challengeId, second);
  const [credential] = await f.owner`SELECT id FROM passkey WHERE credential_id=${second.id}`;
  activeCredentialId = second.id;
  activePasskeyId = String(present(credential)['id']);
  expect(await f.owner`SELECT id FROM passkey WHERE user_id=${f.userId}`).toHaveLength(2);
  expect(
    await f.owner`SELECT id,passkey_id FROM employee_passkeys WHERE employee_id=${f.employeeId}`,
  ).toEqual([{ id: result.binding_id, passkey_id: activePasskeyId }]);
  expect(
    await f.owner`SELECT id FROM employee_passkeys WHERE passkey_id=${present(orphan)['id']}`,
  ).toHaveLength(0);
  expect(await f.owner`SELECT id FROM outbox WHERE aggregate_id=${f.employeeId}`).toHaveLength(1);
});

it('keeps active bindings excluded across companies and drops an unbound credential from exclusions', async () => {
  const requestScope = scope();
  const otherScope = await otherWorkspace(requestScope);
  const device = testAuthenticator();
  const generated = await f.auth.passkeys.enrollmentOptions(otherScope);
  expect(generated.options.excludeCredentials?.map((c) => c.id)).toEqual([activeCredentialId]);
  const response = device.registerNewCredential(generated.options, personalOrigin, 'localhost');
  await enrollment().execute(otherScope, generated.challengeId, response);
  const excluded = (await f.auth.passkeys.enrollmentOptions(requestScope)).options
    .excludeCredentials;
  expect(excluded?.map((c) => c.id).sort()).toEqual([activeCredentialId, response.id].sort());
  await f.owner`UPDATE employee_passkeys SET unbound_at=clock_timestamp(),unbound_by=${f.userId}
    WHERE company_id=${f.companyId} AND passkey_id=${activePasskeyId}`;
  expect(
    (await f.auth.passkeys.enrollmentOptions(requestScope)).options.excludeCredentials?.map(
      (c) => c.id,
    ),
  ).toEqual([response.id]);
  expect(await f.owner`SELECT id FROM passkey WHERE id=${activePasskeyId}`).toHaveLength(1);
});

it('active-binding reads use existing tenant indexes and refuse another user or tenant', async () => {
  expect(
    await f.database.withTenant(f.companyId, (tx) =>
      activePasskeyIds(tx, f.otherCompany, f.userId),
    ),
  ).toEqual([]);
  expect(
    await f.database.withTenant(f.otherCompany, (tx) =>
      activePasskeyIds(tx, f.otherCompany, f.ids.newId()),
    ),
  ).toEqual([]);
  const plan = await f.database.withTenant(f.otherCompany, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON)
      ${activePasskeyStatement(f.otherCompany, f.userId)}`);
  });
  expect(JSON.stringify(plan)).toMatch(/employees_(company_user_idx|pkey)/);
  expect(JSON.stringify(plan)).toContain('employee_passkeys_active_employee_key');
});

function failedBinding() {
  const transactions = createPasskeyTransactions(
    {
      ...f.database,
      withTenant: (company, work, options) =>
        f.database.withTenant(
          company,
          async (tx) => {
            await work(tx);
            throw new Error('SYNTHETIC_ROLLBACK');
          },
          options,
        ),
    },
    f.ids,
  );
  return new EnrolPasskey(
    f.auth.passkeys,
    transactions,
    f.ids,
    { now: () => new Date() },
    createAttendanceDeviceRefusals(f.database, f.ids, () => undefined),
  );
}

async function otherWorkspace(requestScope: PasskeyScope): Promise<PasskeyScope> {
  const businessId = f.ids.newId(),
    branchId = f.ids.newId(),
    employeeId = f.ids.newId();
  await f.owner`INSERT INTO businesses(company_id,id,name_en,vertical_type)
    VALUES(${f.otherCompany},${businessId},'Synthetic second business','salon')`;
  await f.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES(${f.otherCompany},${branchId},${businessId},'Synthetic second branch')`;
  await f.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,user_id,name_en,name_en_key,role_code,hire_date)
    VALUES(${f.otherCompany},${employeeId},${businessId},${branchId},${f.userId},'Synthetic second staff',${employeeNameMatchKey('Synthetic second staff')},'staff','2026-01-01')`;
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    SELECT ${f.otherCompany},${f.ids.newId()},${f.userId},id,'global','BRANCH',${branchId}
    FROM roles WHERE code='staff' AND company_id IS NULL`;
  return { ...requestScope, companyId: f.otherCompany, businessId, employeeId };
}
