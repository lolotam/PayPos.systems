import { randomBytes } from 'node:crypto';
import { createAuth, createPlatformUser, formatDeviceToken, hashDeviceSecret } from '@pospay/auth';
import { createDatabase, PROVISIONAL_PLAN_ID } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';

import { createTestDatabase } from '../../../../../../packages/db/test/test-database.ts';
import { seedReferenceData } from '../../../../../../packages/db/src/seed.ts';
import { createApp } from '../../../app.ts';

const ORIGIN = 'http://admin.test';
const BASE = 'http://api.test';
const PASSWORD = 'synthetic-navigation-password';

export async function preferencesFixture() {
  const fixture = await createTestDatabase();
  await seedReferenceData(fixture.ownerUrl);
  const ids = systemUuidV7();
  const owner = postgres(fixture.ownerUrl, { max: 1, onnotice: () => undefined });
  const auth = await createAuth({
    databaseUrl: fixture.authUrl, staffPhoneLockKey: () => 1n,
    secret: randomBytes(32).toString('hex'), baseURL: BASE, trustedOrigins: [ORIGIN],
    ids, secureCookies: false, onLog: () => undefined,
  });
  const database = createDatabase({ url: fixture.appUrl, ids });
  const app = await createApp({ readiness: [], auth: { service: auth, baseURL: BASE },
    database, ids, corsOrigins: [ORIGIN] }, { logger: createLogger('silent') });
  const postAuth = (path: string, body: object) => app.inject({
    method: 'POST', url: `/v1/auth${path}`, headers: { origin: ORIGIN }, payload: body,
  });
  const login = async (email: string) => {
    const res = await postAuth('/sign-in/email', { email, password: PASSWORD });
    if (res.statusCode !== 200) throw new Error('Synthetic sign-in failed');
    const cookies = res.headers['set-cookie'];
    return (Array.isArray(cookies) ? cookies : [cookies ?? '']).map((v) => v.split(';')[0]).join('; ');
  };
  const makeUser = async (email: string) => {
    const { userId, link } = await createPlatformUser(auth, { email, name: 'Synthetic',
      operator: 'test', redirectTo: `${ORIGIN}/set-password` });
    const resetCode = new URL(link).pathname.split('/').pop();
    await postAuth('/reset-password', { token: resetCode, newPassword: PASSWORD });
    return { userId, cookie: await login(email) };
  };
  return { app, auth, owner, ids, makeUser, login,
    device: (userId: string) => makeDevice(owner, ids.newId, userId),
    close: async () => { await app.close(); await auth.close(); await database.close(); await owner.end(); await fixture.drop(); },
  };
}

async function makeDevice(owner: postgres.Sql, newId: () => string, userId: string) {
  const companyId = newId(), businessId = newId(), branchId = newId(), deviceId = newId();
  const credential = randomBytes(32).toString('base64url');
  await owner`INSERT INTO companies(id,name_en,owner_user_id,plan_id) VALUES(${companyId},'Synthetic',${userId},${PROVISIONAL_PLAN_ID})`;
  await owner`INSERT INTO businesses(company_id,id,vertical_type,name_en) VALUES(${companyId},${businessId},'retail','Synthetic')`;
  await owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${companyId},${branchId},${businessId},'Synthetic')`;
  await owner`INSERT INTO devices(company_id,id,branch_id,label,status,token_hash,token_expires_at,approved_by,approved_at)
    VALUES(${companyId},${deviceId},${branchId},'Synthetic','ACTIVE',${hashDeviceSecret(credential)},now()+interval '1 day',${userId},now())`;
  return { companyId, businessId, branchId, deviceId,
    authorization: `Device ${formatDeviceToken({ companyId, deviceId, secret: credential })}` };
}
