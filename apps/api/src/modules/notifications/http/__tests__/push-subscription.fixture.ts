import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createAuth, type AuthService } from '@pospay/auth';
import { createDatabase, PROVISIONAL_PLAN_ID } from '@pospay/db';
import { employeeNameMatchKey } from '@pospay/domain';
import { systemUuidV7 } from '@pospay/ids';
import { phoneLockKey, vapidKeyId, type PushApiConfiguration } from '@pospay/notifications';
import postgres from 'postgres';

import { seedReferenceData } from '../../../../../../../packages/db/src/seed.ts';
import { createTestDatabase } from '../../../../../../../packages/db/test/test-database.ts';
import { createApp } from '../../../../app.ts';
import { createPersonalEligibility } from '../../../staff/index.ts';
import { takeTestEmployeeNumber } from '../../../../../test/test-employee-number.ts';

export const personalOrigin = 'http://localhost:5173';
export const adminOrigin = 'http://admin.test';
const BASE_URL = 'http://localhost:3000';

export const pushFixtureConfig: PushApiConfiguration = (() => {
  const publicKey = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 7)]).toString('base64url');
  return { publicKey, keyId: vapidKeyId(publicKey), subject: 'mailto:ops@pospay.systems' };
})();

export interface StaffSession {
  readonly userId: string;
  readonly companyId: string;
  readonly cookie: string;
  readonly headers: Record<string, string>;
}

export interface PushFixture {
  readonly app: NestFastifyApplication;
  readonly owner: postgres.Sql;
  readonly auth: AuthService;
  readonly ids: { newId(): string };
  readonly userId: string;
  readonly companyId: string;
  readonly config: PushApiConfiguration;
  readonly cookie: string;
  readonly headers: Record<string, string>;
  send(
    method: 'GET' | 'PUT' | 'POST',
    url: string,
    options?: { body?: unknown; headers?: Record<string, string> },
  ): Promise<{ status: number; body: Record<string, unknown> }>;
  adopt(session: StaffSession): void;
  primarySession(): Promise<StaffSession>;
  seedStaff(label: string): Promise<StaffSession>;
  seedCompany(label: string): Promise<StaffSession>;
  receptionCookie(): Promise<string>;
  adminCookie(): Promise<string>;
  close(): Promise<void>;
}

export async function pushFixture(options: { configured?: boolean } = {}): Promise<PushFixture> {
  const test = await createTestDatabase();
  await seedReferenceData(test.ownerUrl);
  const owner = postgres(test.ownerUrl, { max: 4, onnotice: () => undefined });
  const ids = systemUuidV7();
  const database = createDatabase({ url: test.appUrl, ids });
  const auth = await createAuth({
    staffPhoneLockKey: phoneLockKey,
    databaseUrl: test.authUrl,
    secret: 'synthetic'.repeat(8),
    baseURL: BASE_URL,
    trustedOrigins: [personalOrigin, adminOrigin],
    ids,
    secureCookies: false,
    onLog: () => undefined,
  });
  let phone = 1;
  const seedCompanyRows = async (label: string, ownerUserId: string) => {
    const companyId = ids.newId();
    const businessId = ids.newId();
    const branchId = ids.newId();
    await owner`INSERT INTO companies(id,name_en,owner_user_id,plan_id)
      VALUES(${companyId},${label},${ownerUserId},${PROVISIONAL_PLAN_ID})`;
    await owner`INSERT INTO businesses(company_id,id,name_en,vertical_type)
      VALUES(${companyId},${businessId},${label},'salon')`;
    await owner`INSERT INTO branches(company_id,id,business_id,name_en)
      VALUES(${companyId},${branchId},${businessId},${label})`;
    await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
      SELECT ${companyId},${ids.newId()},${ownerUserId},id,'global','BRANCH',${branchId}
      FROM roles WHERE code='staff' AND company_id IS NULL`;
    return { companyId, businessId, branchId };
  };
  const seedEmployee = async (
    label: string,
    employeeUserId: string,
    company: { companyId: string; businessId: string; branchId: string },
  ) => {
    const employeeId = ids.newId();
    await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,user_id,name_en,name_en_key,role_code,hire_date,employee_number)
      VALUES(${company.companyId},${employeeId},${company.businessId},${company.branchId},${employeeUserId},${label},
        ${employeeNameMatchKey(label)},'staff','2026-01-01',${takeTestEmployeeNumber(company.companyId)})`;
    await owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
      VALUES(${company.companyId},${ids.newId()},${company.businessId},${employeeId},${company.branchId},'2026-01-01')`;
  };
  const seedUser = async (label: string) => {
    const userId = ids.newId();
    phone += 1;
    await owner`INSERT INTO "user"(id,name,email,phone_number,phone_binding_approved_at)
      VALUES(${userId},${label},${label.replaceAll(' ', '-')}@example.test,${`+9655550000${phone}`},clock_timestamp())`;
    return userId;
  };
  const session = async (
    sessionUserId: string,
    company: { companyId: string; businessId: string },
  ): Promise<StaffSession> => {
    const issued = await auth.personal.issue(
      sessionUserId,
      { purpose: 'STAFF_PERSONAL', companyId: company.companyId, businessId: company.businessId },
      async () => true,
    );
    const cookie = issued.cookie.split(';')[0] ?? '';
    return {
      userId: sessionUserId,
      companyId: company.companyId,
      cookie,
      headers: { cookie, origin: personalOrigin },
    };
  };
  const userId = await seedUser('Synthetic staff');
  const first = await seedCompanyRows('Synthetic employer', userId);
  await seedEmployee('Synthetic staff', userId, first);
  const app = await createApp({
    readiness: [],
    auth: { service: auth, baseURL: BASE_URL },
    database,
    personal: {
      origin: personalOrigin,
      sessions: auth.personal,
      eligibility: createPersonalEligibility(database),
      otp: null,
    },
    ...(options.configured === false ? {} : { push: pushFixtureConfig }),
  });
  await app.getHttpAdapter().getInstance().ready();
  let current = await session(userId, first);
  const send = async (
    method: 'GET' | 'PUT' | 'POST',
    url: string,
    options: { body?: unknown; headers?: Record<string, string> } = {},
  ) => {
    const response = await app.inject({
      method,
      url,
      headers: { ...current.headers, ...(options.headers ?? {}) },
      ...(options.body === undefined ? {} : { payload: options.body }),
    });
    return {
      status: response.statusCode,
      body: (response.body === '' ? {} : response.json()) as Record<string, unknown>,
    };
  };
  return {
    app,
    owner,
    auth,
    ids,
    userId,
    companyId: first.companyId,
    config: pushFixtureConfig,
    get cookie() {
      return current.cookie;
    },
    get headers() {
      return current.headers;
    },
    send,
    adopt: (value) => {
      current = value;
    },
    primarySession: async () => {
      current = await session(userId, first);
      return current;
    },
    seedStaff: async (label: string) => {
      const staffUserId = await seedUser(label);
      await seedEmployee(label, staffUserId, first);
      return session(staffUserId, first);
    },
    seedCompany: async (label: string) => {
      const other = await seedCompanyRows(label, userId);
      await seedEmployee('Synthetic staff', userId, other);
      return session(userId, other);
    },
    receptionCookie: async () => {
      const kiosk = await auth.staff.issue(
        userId,
        {
          companyId: first.companyId,
          businessId: first.businessId,
          branchId: first.branchId,
          deviceId: ids.newId(),
        },
        async () => true,
      );
      return kiosk.cookie.split(';')[0] ?? '';
    },
    adminCookie: async () => {
      const email = 'push-admin@example.test';
      const password = 'synthetic-admin-password';
      await auth.provisionUser({ email, name: 'Synthetic admin', password });
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/sign-in/email',
        headers: { origin: adminOrigin },
        payload: { email, password },
      });
      const setCookie = response.headers['set-cookie'];
      return (Array.isArray(setCookie) ? setCookie : [setCookie ?? ''])
        .map((value) => value.split(';')[0])
        .join('; ');
    },
    close: async () => {
      await app.close();
      await auth.close();
      await database.close();
      await owner.end();
      await test.drop();
    },
  };
}
