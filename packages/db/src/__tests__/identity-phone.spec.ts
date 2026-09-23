import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

// T9b: the phone-number plugin's columns exist on "user" before the plugin is wired (P1-T7). The database already
// refuses what the plugin must never store: a number that is not E.164, or one number on two users.
let testDb: TestDatabase;
let owner: postgres.Sql;

beforeAll(async () => {
  testDb = await createTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  await owner.end();
  await testDb.drop();
});

const insert = (id: string, email: string, phone: string | null) =>
  owner`INSERT INTO "user" (id, name, email, phone_number) VALUES (${id}, 'U', ${email}, ${phone})`;

describe('user.phone_number', () => {
  it('accepts an E.164 number or none, and refuses anything else', async () => {
    await insert('01920000-0000-7000-8000-0000000000e1', 'p1@example.test', '+96550000001');
    await insert('01920000-0000-7000-8000-0000000000e2', 'p2@example.test', null);
    for (const bad of ['96550000001', '+0123456789', '+965 5000 0001', '+1']) {
      await expect(
        insert('01920000-0000-7000-8000-0000000000e3', 'p3@example.test', bad),
      ).rejects.toThrow(/user_phone_number_e164/);
    }
  });

  it('belongs to one user only', async () => {
    await expect(
      insert('01920000-0000-7000-8000-0000000000e4', 'p4@example.test', '+96550000001'),
    ).rejects.toThrow(/user_phone_number_key/);
  });
});
