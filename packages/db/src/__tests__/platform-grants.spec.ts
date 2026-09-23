import { createUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { grantPlatformPermission, revokePlatformPermission } from '../platform-grants.ts';
import { seedReferenceData } from '../seed.ts';

// T9a-3: platform grants are written only by the operator script as pospay_owner, always with an audit row, and
// no runtime role can write them or rewrite the audit trail (ADR-0003 §3).
const PERMISSION = 'create:companies:platform';
const USER = '01920000-0000-7000-8000-0000000000f7';
let clock = 1_900_000_000_000;
const ids = createUuidV7({ now: () => ++clock, fillRandom: (bytes) => bytes.fill(7) });
const request = { email: 'Operator@Example.test', permission: PERMISSION, operator: 'waleed' };

let testDb: TestDatabase;
let owner: postgres.Sql;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedReferenceData(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO "user" (id, name, email) VALUES (${USER}, 'Op', 'operator@example.test')`;
});

afterAll(async () => {
  await owner.end();
  await testDb.drop();
});

const audit = () =>
  owner<{ action: string; actor: string; target_user_id: string }[]>`
    SELECT action, actor, target_user_id FROM platform_audit_log ORDER BY at, id`;

describe('grant and revoke, each with its audit row', () => {
  it('grants once, is idempotent while the grant is active, and audits only the real change', async () => {
    const first = await grantPlatformPermission(testDb.ownerUrl, request, ids);
    expect(first).toMatchObject({ status: 'granted', userId: USER });
    expect(await grantPlatformPermission(testDb.ownerUrl, request, ids)).toMatchObject({
      status: 'already-granted',
    });
    expect(await audit()).toEqual([
      { action: 'grant.granted', actor: 'waleed', target_user_id: USER },
    ]);
  });

  it('revokes by keeping the row with who and when, audits it, and a second revoke changes nothing', async () => {
    expect(await revokePlatformPermission(testDb.ownerUrl, request, ids)).toMatchObject({
      status: 'revoked',
    });
    expect(await revokePlatformPermission(testDb.ownerUrl, request, ids)).toMatchObject({
      status: 'not-granted',
    });
    const [row] =
      await owner`SELECT revoked_by, revoked_at IS NOT NULL AS revoked FROM platform_grants`;
    expect(row).toEqual({ revoked_by: 'waleed', revoked: true });
    expect((await audit()).map((r) => r.action)).toEqual(['grant.granted', 'grant.revoked']);
  });

  it('refuses an unknown email and a permission that is not a platform one', async () => {
    await expect(
      grantPlatformPermission(testDb.ownerUrl, { ...request, email: 'nobody@example.test' }, ids),
    ).rejects.toThrow(/no user with that email/);
    await expect(
      grantPlatformPermission(
        testDb.ownerUrl,
        { ...request, permission: 'read:memberships:company' },
        ids,
      ),
    ).rejects.toThrow(/platform_grants_permission_scope/);
  });
});

describe('runtime roles cannot write grants or rewrite the audit trail', () => {
  const as = (url: string) => postgres(url, { max: 1, onnotice: () => undefined });

  it('pospay_auth reads grants and appends audit rows, and nothing more', async () => {
    const auth = as(testDb.authUrl);
    try {
      await expect(auth`SELECT count(*) FROM platform_grants`).resolves.toBeDefined();
      await expect(
        auth`INSERT INTO platform_grants (id, user_id, permission, granted_by)
             VALUES (${ids.newId()}, ${USER}, ${PERMISSION}, 'self')`,
      ).rejects.toThrow(/permission denied/);
      await expect(auth`UPDATE platform_audit_log SET actor = 'x'`).rejects.toThrow(
        /permission denied/,
      );
      await expect(auth`DELETE FROM platform_audit_log`).rejects.toThrow(/permission denied/);
      await expect(auth`SELECT * FROM platform_audit_log`).rejects.toThrow(/permission denied/);
    } finally {
      await auth.end();
    }
  });

  it('pospay_app sees neither table', async () => {
    const app = as(testDb.appUrl);
    try {
      await expect(app`SELECT * FROM platform_grants`).rejects.toThrow(/permission denied/);
      await expect(app`SELECT * FROM platform_audit_log`).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
  });
});
