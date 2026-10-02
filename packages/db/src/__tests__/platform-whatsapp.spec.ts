import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createPlatformWhatsappDatabase, type PlatformWhatsappDatabase } from '../index.ts';

let test: TestDatabase;
let owner: postgres.Sql;
let intake: postgres.Sql;
let global: PlatformWhatsappDatabase;
const hash = Buffer.alloc(32, 11);
const at = '2026-10-01T10:00:00Z';

beforeAll(async () => {
  test = await createTestDatabase();
  owner = postgres(test.ownerUrl, { max: 1, onnotice: () => undefined });
  intake = postgres(test.notificationsUrl, { max: 1, onnotice: () => undefined });
  global = createPlatformWhatsappDatabase({ url: test.notificationsUrl });
});
afterAll(async () => {
  await global.close();
  await intake.end();
  await owner.end();
  await test.drop();
});

it('is ready with exact grants; exposes transactions only', async () => {
  expect(Object.keys(global).sort()).toEqual(['close', 'ping', 'withGlobal']);
  await expect(global.ping()).resolves.toBeUndefined();
});

it('allows intended column insert/upsert and rejects naming the opt-in column even as NULL', async () => {
  await intake`INSERT INTO platform_whatsapp_suppressions
      (recipient_hash,hash_key_id,source,first_opted_out_at,last_opted_out_at)
      VALUES (${hash},'test-v1','STOP',${at},${at})
      ON CONFLICT (recipient_hash) DO UPDATE SET source='STOP',last_opted_out_at=EXCLUDED.last_opted_out_at`;
  await expect(intake`INSERT INTO platform_whatsapp_suppressions
      (recipient_hash,hash_key_id,source,first_opted_out_at,last_opted_out_at,opted_back_in_at)
      VALUES (${Buffer.alloc(32, 12)},'test-v1','STOP',${at},${at},NULL)`).rejects.toThrow(
    /permission denied/,
  );
  await expect(
    intake`UPDATE platform_whatsapp_suppressions SET opted_back_in_at = NULL`,
  ).rejects.toThrow(/permission denied/);
  await expect(
    intake`UPDATE platform_whatsapp_suppressions SET first_opted_out_at = ${at}`,
  ).rejects.toThrow(/permission denied/);
  await expect(
    intake`UPDATE platform_whatsapp_suppressions SET hash_key_id = 'test-v2'`,
  ).rejects.toThrow(/permission denied/);
});

it('CHECK rejects privileged non-NULL INSERT and UPDATE', async () => {
  await expect(owner`INSERT INTO platform_whatsapp_suppressions
      (recipient_hash,hash_key_id,source,first_opted_out_at,last_opted_out_at,opted_back_in_at)
      VALUES (${Buffer.alloc(32, 13)},'test-v1','STOP',${at},${at},${at})`).rejects.toThrow(
    /null_only/,
  );
  await expect(
    owner`UPDATE platform_whatsapp_suppressions SET opted_back_in_at = ${at} WHERE recipient_hash = ${hash}`,
  ).rejects.toThrow(/null_only/);
});

it.each(['companies', 'user', 'outbox', 'plans', 'memberships'])(
  'intake cannot read %s',
  async (table) => {
    await expect(intake.unsafe(`SELECT 1 FROM "${table}"`)).rejects.toThrow(/permission denied/);
  },
);

it('intake cannot delete/truncate/audit-read/update or assume the reader', async () => {
  await expect(intake`DELETE FROM platform_whatsapp_suppressions`).rejects.toThrow(
    /permission denied/,
  );
  await expect(intake`TRUNCATE platform_whatsapp_inbox`).rejects.toThrow(/permission denied/);
  await expect(intake`SELECT 1 FROM platform_whatsapp_audit`).rejects.toThrow(/permission denied/);
  await expect(
    intake`UPDATE platform_whatsapp_audit SET reason='OPERATOR_REQUEST'`,
  ).rejects.toThrow(/permission denied/);
  await expect(intake`SET ROLE pospay_suppression_reader`).rejects.toThrow(/permission denied/);
});

it('app gets only the boolean function; auth/dispatcher/intake cannot execute it', async () => {
  for (const [url, allowed] of [
    [test.appUrl, true],
    [test.authUrl, false],
    [test.dispatcherUrl, false],
    [test.notificationsUrl, false],
  ] as const) {
    const raw = postgres(url, { max: 1, onnotice: () => undefined });
    try {
      for (const table of [
        'platform_whatsapp_suppressions',
        'platform_whatsapp_inbox',
        'platform_whatsapp_audit',
      ]) {
        if (url !== test.notificationsUrl)
          await expect(raw.unsafe(`SELECT 1 FROM ${table}`)).rejects.toThrow(/permission denied/);
      }
      if (allowed) {
        expect(await raw`SELECT platform_whatsapp_is_suppressed(${hash}) AS value`).toEqual([
          { value: true },
        ]);
        await expect(raw`SELECT platform_whatsapp_is_suppressed(NULL)`).rejects.toThrow(
          'SUPPRESSION_HASH_INVALID',
        );
        await expect(
          raw`SELECT platform_whatsapp_is_suppressed(${Buffer.alloc(1)})`,
        ).rejects.toThrow('SUPPRESSION_HASH_INVALID');
      } else
        await expect(raw`SELECT platform_whatsapp_is_suppressed(${hash})`).rejects.toThrow(
          /permission denied/,
        );
    } finally {
      await raw.end();
    }
  }
});

it('no runtime role has effective write access to opted_back_in_at', async () => {
  const rows = await owner`SELECT rolname FROM pg_roles WHERE rolname IN
      ('pospay_app','pospay_auth','pospay_dispatcher','pospay_notifications','pospay_suppression_reader')
      AND (has_column_privilege(oid,'platform_whatsapp_suppressions','opted_back_in_at','INSERT,UPDATE')
        OR has_table_privilege(oid,'platform_whatsapp_suppressions','INSERT,UPDATE'))`;
  expect(rows).toHaveLength(0);
});

it('inventory rejects excess column and table grants', async () => {
  try {
    await owner`GRANT UPDATE (opted_back_in_at) ON platform_whatsapp_suppressions TO pospay_notifications`;
    await expect(global.ping()).rejects.toThrow('PLATFORM_WHATSAPP_PRIVILEGES_INVALID');
  } finally {
    await owner`REVOKE UPDATE (opted_back_in_at) ON platform_whatsapp_suppressions FROM pospay_notifications`;
  }
  try {
    await owner`GRANT INSERT ON platform_whatsapp_suppressions TO pospay_notifications`;
    await expect(global.ping()).rejects.toThrow('PLATFORM_WHATSAPP_PRIVILEGES_INVALID');
  } finally {
    await owner`REVOKE INSERT ON platform_whatsapp_suppressions FROM pospay_notifications`;
    await owner`GRANT INSERT (recipient_hash,hash_key_id,source,first_opted_out_at,last_opted_out_at) ON platform_whatsapp_suppressions TO pospay_notifications`;
  }
  await global.ping();
});

it('readiness rejects missing or unvalidated constraint', async () => {
  try {
    await owner`ALTER TABLE platform_whatsapp_suppressions DROP CONSTRAINT platform_whatsapp_suppressions_null_only`;
    await expect(global.ping()).rejects.toThrow('PLATFORM_WHATSAPP_PRIVILEGES_INVALID');
    await owner`ALTER TABLE platform_whatsapp_suppressions ADD CONSTRAINT platform_whatsapp_suppressions_null_only CHECK (opted_back_in_at IS NULL) NOT VALID`;
    await expect(global.ping()).rejects.toThrow('PLATFORM_WHATSAPP_PRIVILEGES_INVALID');
  } finally {
    await owner`ALTER TABLE platform_whatsapp_suppressions VALIDATE CONSTRAINT platform_whatsapp_suppressions_null_only`;
  }
  await global.ping();
});

it('wrong serving role fails readiness and work', async () => {
  const wrong = createPlatformWhatsappDatabase({ url: test.ownerUrl });
  try {
    await expect(wrong.ping()).rejects.toThrow('PLATFORM_WHATSAPP_PRIVILEGES_INVALID');
    await expect(wrong.withGlobal(async () => undefined)).rejects.toThrow(
      'PLATFORM_WHATSAPP_PRIVILEGES_INVALID',
    );
  } finally {
    await wrong.close();
  }
});

it('rejects column-only tenant reads and excess definer EXECUTE even without table grants', async () => {
  try {
    await owner`GRANT SELECT (id) ON companies TO pospay_notifications`;
    await expect(global.ping()).rejects.toThrow('PLATFORM_WHATSAPP_PRIVILEGES_INVALID');
  } finally {
    await owner`REVOKE SELECT (id) ON companies FROM pospay_notifications`;
  }
  try {
    await owner`GRANT EXECUTE ON FUNCTION platform_whatsapp_is_suppressed(bytea) TO PUBLIC`;
    await expect(global.ping()).rejects.toThrow('PLATFORM_WHATSAPP_PRIVILEGES_INVALID');
  } finally {
    await owner`REVOKE EXECUTE ON FUNCTION platform_whatsapp_is_suppressed(bytea) FROM PUBLIC`;
  }
  await global.ping();
});
