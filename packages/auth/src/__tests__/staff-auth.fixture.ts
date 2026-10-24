import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { systemUuidV7 } from '@pospay/ids';
import { createTestDatabase, type TestDatabase } from '../../../db/test/test-database.ts';
import { createAuth, type AuthService } from '../config.ts';
import type { StaffDeviceContext } from '../staff-otp/types.ts';

// The sign-out tests only exercise device locks, so the phone lock key stays local and deterministic.
const staffPhoneLockKey = (hash: Uint8Array): bigint => {
  const digest = createHash('sha256').update('pospay:test:phone-lock\0').update(hash).digest();
  return digest.readBigInt64LE(0);
};

/** The shared setup of the staff session tests: one database, one owner, one approved user, one device. */
export interface StaffAuthFixture {
  readonly test: TestDatabase;
  readonly owner: postgres.Sql;
  readonly auth: AuthService;
  readonly userId: string;
  readonly device: StaffDeviceContext;
  /** The auth clock; a test moves it by writing `clock.now`. */
  readonly clock: { now: Date };
  close(): Promise<void>;
}

/**
 * Builds the staff auth fixture the session and sign-out tests share.
 *
 * @returns the database, its owner connection, the auth service, the approved user, the device and the clock
 */
export async function staffAuthFixture(): Promise<StaffAuthFixture> {
  const test = await createTestDatabase();
  const owner = postgres(test.ownerUrl, { max: 1, onnotice: () => undefined });
  const clock = { now: new Date() };
  const device: StaffDeviceContext = {
    companyId: randomUUID(),
    businessId: randomUUID(),
    branchId: randomUUID(),
    deviceId: randomUUID(),
  };
  const auth = await createAuth({
    databaseUrl: test.authUrl,
    staffPhoneLockKey,
    secret: 'synthetic'.repeat(8),
    baseURL: 'https://api.synthetic.invalid',
    trustedOrigins: ['https://pos.synthetic.invalid', 'https://admin.synthetic.invalid'],
    ids: systemUuidV7(),
    secureCookies: true,
    cookieDomain: '.synthetic.invalid',
    clock: { now: () => clock.now },
    onLog: () => undefined,
  });
  const userId = await auth.provisionUser({
    email: 'synthetic@session.invalid',
    name: 'synthetic',
    password: 'synthetic'.repeat(8),
  });
  await owner`UPDATE "user" SET phone_number='+99900000001' WHERE id=${userId}`;
  await owner`UPDATE "user" SET phone_binding_approved_at=${clock.now} WHERE id=${userId}`;
  return {
    test,
    owner,
    auth,
    userId,
    device,
    clock,
    close: async () => {
      await auth.close();
      await owner.end();
      await test.drop();
    },
  };
}
