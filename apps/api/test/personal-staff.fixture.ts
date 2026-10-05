import {
  createAuth,
  createStaffOtpApi,
  type PersonalSession,
  type PersonalWorkspace,
} from '@pospay/auth';
import { createDatabase, PROVISIONAL_PLAN_ID } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { phoneLockKey } from '@pospay/notifications';
import postgres from 'postgres';
import type { Redis } from 'ioredis';
import { createStaffOtpDatabase } from '../../../packages/db/src/staff-otp-database.ts';
import { createTestDatabase } from '../../../packages/db/test/test-database.ts';
import { seedReferenceData } from '../../../packages/db/src/seed.ts';
import { warmOtpTables } from '../../../packages/db/test/otp-fixtures.ts';
import { createOtpCrypto } from '../../../packages/auth/src/staff-otp/crypto.ts';
import { present } from '../../../packages/db/test/present.ts';
import { createApp } from '../src/app.ts';
import {
  createActivePasskeyBindings,
  createPersonalEligibility,
} from '../src/modules/staff/index.ts';
import { membershipCompanies } from '../src/modules/identity/index.ts';
import { keys, identity, phone } from './staff-otp-harness.ts';

export const personalOrigin = 'http://localhost:5173';
export async function personalFixture(redis?: Redis) {
  const test = await createTestDatabase();
  await seedReferenceData(test.ownerUrl);
  const owner = postgres(test.ownerUrl, { max: 4, onnotice: () => undefined });
  const ids = systemUuidV7();
  const { userId, companyId, businessId, branchId, otherCompany, employeeId, membershipId } =
    await seedPersonalRecords(owner, ids);
  const database = createDatabase({ url: test.appUrl, ids, boundedTenantTransactions: true });
  const auth = await createAuth({
    passkeyBindings: createActivePasskeyBindings(database, {
      forUser: (userId) => membershipCompanies(database, userId),
    }),
    databaseUrl: test.authUrl,
    staffPhoneLockKey: phoneLockKey,
    secret: 'synthetic'.repeat(8),
    baseURL: 'http://localhost:3000',
    trustedOrigins: [personalOrigin],
    ids,
    secureCookies: false,
    onLog: () => undefined,
  });
  const eligibility = createPersonalEligibility(database);
  const ledger = createStaffOtpDatabase({ url: test.authUrl, phoneLockKey });
  await warmOtpTables(owner);
  await ledger.ping();
  const jobs: { challengeId: string; attemptId: string }[] = [];
  const otp = personalOtp(test.authUrl, auth, eligibility, ids, jobs);
  const app = await createApp({
    readiness: [],
    auth: { service: auth, baseURL: 'http://localhost:3000' },
    database,
    ...(redis === undefined ? {} : { redis }),
    personal: { origin: personalOrigin, sessions: auth.personal, eligibility, otp },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return {
    test,
    owner,
    ids,
    userId,
    companyId,
    businessId,
    branchId,
    otherCompany,
    employeeId,
    membershipId,
    database,
    auth,
    otp,
    jobs,
    app,
    code: async (id: string) => createOtpCrypto(keys).derive(present(await ledger.find(id))),
    close: () => closePersonalFixture([app, otp, ledger, auth, database], owner, test),
  };
}

async function seedPersonalRecords(owner: postgres.Sql, ids: ReturnType<typeof systemUuidV7>) {
  const userId = ids.newId(),
    companyId = ids.newId(),
    businessId = ids.newId(),
    branchId = ids.newId();
  const otherCompany = ids.newId(),
    employeeId = ids.newId(),
    membershipId = ids.newId();
  await owner`INSERT INTO "user"(id,name,email,phone_number,phone_binding_approved_at)
    VALUES(${userId},'Synthetic personal staff','personal@example.test',${phone},clock_timestamp())`;
  for (const company of [companyId, otherCompany])
    await owner`INSERT INTO companies(id,name_en,owner_user_id,plan_id)
    VALUES(${company},'Synthetic employer',${userId},${PROVISIONAL_PLAN_ID})`;
  await owner`INSERT INTO businesses(company_id,id,name_en,vertical_type) VALUES(${companyId},${businessId},'Synthetic business','salon')`;
  await owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${companyId},${branchId},${businessId},'Synthetic branch')`;
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,user_id,name_en,role_code,hire_date)
    VALUES(${companyId},${employeeId},${businessId},${branchId},${userId},'Synthetic staff','staff','2026-01-01')`;
  await owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${companyId},${ids.newId()},${businessId},${employeeId},${branchId},'2026-01-01')`;
  await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    SELECT ${companyId},${membershipId},${userId},id,'global','BRANCH',${branchId} FROM roles WHERE code='staff' AND company_id IS NULL`;
  return { userId, companyId, businessId, branchId, otherCompany, employeeId, membershipId };
}

function personalOtp(
  databaseUrl: string,
  auth: Awaited<ReturnType<typeof createAuth>>,
  eligibility: ReturnType<typeof createPersonalEligibility>,
  ids: ReturnType<typeof systemUuidV7>,
  jobs: { challengeId: string; attemptId: string }[],
) {
  const configuration = () => ({
    state: 'READY' as const,
    keys,
    fingerprint: 'synthetic',
    templates: { ar: 'synthetic_ar', en: 'synthetic_en' },
    posOrigin: personalOrigin,
  });
  return createStaffOtpApi<PersonalWorkspace, PersonalSession>({
    databaseUrl,
    configuration,
    capability: { ready: async () => true },
    rates: { request: async () => 0, verify: async () => 0 },
    sender: {
      enqueue: async (job) => {
        jobs.push(job);
      },
    },
    strategies: { identify: identity.identify, phoneLockKey },
    eligibility,
    sessions: auth.personal,
    ids,
    clock: {
      now: () => new Date(),
      waitUntil: (deadline) =>
        new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline.getTime() - Date.now()))),
    },
    audit: async () => undefined,
  });
}

async function closePersonalFixture(
  resources: { close(): Promise<void> }[],
  owner: postgres.Sql,
  test: Awaited<ReturnType<typeof createTestDatabase>>,
) {
  for (const resource of resources) await resource.close();
  await owner.end();
  await test.drop();
}
