import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TENANT, USER, seedTwoTenants } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { appendAuditLog, appendOutboxEvent, createDatabase, type Database } from '../index.ts';

// plan v4 T7: the outbox row lives and dies with the caller's transaction; audit_log is insert-only;
// both take the company (and the actor) from the context, never from the caller.
let testDb: TestDatabase;
let database: Database;
let owner: postgres.Sql;
let sequence = 0;
const nextId = (): string => `01930000-0000-7000-8000-${String(++sequence).padStart(12, '0')}`;

const event = (aggregateId: string = TENANT.A.business) => ({
  aggregateType: 'business',
  aggregateId,
  eventType: 'BusinessCreated',
  payload: { nameEn: 'Salon', mills: '12500' },
});

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  database = createDatabase({ url: testDb.appUrl, ids: { newId: nextId } });
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  await database.close();
  await owner.end();
  await testDb.drop();
});

const outboxRows = (id: string) =>
  owner`SELECT company_id, event_type, payload FROM outbox WHERE id = ${id}`;

describe('outbox', () => {
  it('a committed transaction leaves its event, stamped with the context company', async () => {
    const id = nextId();
    await database.withTenant(TENANT.A.company, (tx) => appendOutboxEvent(tx, id, event()));
    expect(Array.from(await outboxRows(id))).toEqual([
      {
        company_id: TENANT.A.company,
        event_type: 'BusinessCreated',
        payload: { nameEn: 'Salon', mills: '12500' },
      },
    ]);
  });

  it('(a) a rolled-back transaction leaves no outbox row', async () => {
    const id = nextId();
    await expect(
      database.withTenant(TENANT.A.company, async (tx) => {
        await appendOutboxEvent(tx, id, event());
        throw new Error('business rule failed after the event was appended');
      }),
    ).rejects.toThrow('business rule failed');
    expect(await outboxRows(id)).toHaveLength(0);
  });

  it('cannot be written without a tenant context', async () => {
    await expect(
      database.withUser(USER, (tx) => appendOutboxEvent(tx, nextId(), event())),
    ).rejects.toThrow();
  });

  it('the app can only append — it cannot read, change or delete events', async () => {
    const app = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
    try {
      await expect(app`SELECT 1 FROM outbox`).rejects.toThrow(/permission denied/);
      await expect(app`UPDATE outbox SET attempts = 1`).rejects.toThrow(/permission denied/);
      await expect(app`DELETE FROM outbox`).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
  });

  it('rejects a payload that is not JSON and an event name outside the convention', async () => {
    await expect(
      database.withTenant(TENANT.A.company, (tx) =>
        appendOutboxEvent(tx, nextId(), { ...event(), payload: undefined }),
      ),
    ).rejects.toThrow(TypeError);
    await expect(
      database.withTenant(TENANT.A.company, (tx) =>
        appendOutboxEvent(tx, nextId(), { ...event(), eventType: 'business created' }),
      ),
    ).rejects.toMatchObject({ cause: { constraint_name: 'outbox_event_type_format' } });
  });
});

const entry = {
  entity: 'business',
  entityId: TENANT.A.business,
  action: 'created',
  after: { a: 1 },
};

describe('audit_log', () => {
  it('records the context company and acting user, and NULL for a system action', async () => {
    const [withUser, system] = [nextId(), nextId()];
    await database.withTenant(TENANT.A.company, (tx) => appendAuditLog(tx, withUser, entry), {
      userId: USER,
    });
    await database.withTenant(TENANT.A.company, (tx) => appendAuditLog(tx, system, entry));
    const rows = await owner`
      SELECT id, company_id, actor_user_id, before, after FROM audit_log
      WHERE id IN (${withUser}, ${system}) ORDER BY id`;
    expect(Array.from(rows)).toEqual([
      {
        id: withUser,
        company_id: TENANT.A.company,
        actor_user_id: USER,
        before: null,
        after: { a: 1 },
      },
      {
        id: system,
        company_id: TENANT.A.company,
        actor_user_id: null,
        before: null,
        after: { a: 1 },
      },
    ]);
  });

  it("company B cannot see company A's entries", async () => {
    const id = nextId();
    await database.withTenant(TENANT.A.company, (tx) => appendAuditLog(tx, id, entry));
    const seen = await database.withTenant(TENANT.B.company, (tx) =>
      tx.execute(`SELECT 1 FROM audit_log WHERE id = '${id}'`),
    );
    expect(seen).toHaveLength(0);
  });

  it('is insert-only: the app cannot update or delete an entry', async () => {
    const app = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
    try {
      await expect(app`UPDATE audit_log SET action = 'x'`).rejects.toThrow(/permission denied/);
      await expect(app`DELETE FROM audit_log`).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
  });
});

describe('audit_log snapshots', () => {
  it('never stores a secret in a snapshot — the row is kept forever', async () => {
    const id = nextId();
    await database.withTenant(TENANT.A.company, (tx) =>
      appendAuditLog(tx, id, {
        ...entry,
        before: { pinHash: 'argon2-leak', device: { token: 'tok_leak' }, name: 'Old' },
        after: { name: 'New' },
      }),
    );
    const [row] = await owner`SELECT before FROM audit_log WHERE id = ${id}`;
    expect(row?.['before']).toEqual({
      pinHash: '[REDACTED]',
      device: { token: '[REDACTED]' },
      name: 'Old',
    });
  });
});

// Direct INSERTs that name another tenant: the writers never do this, but a hand-written query in a
// later slice could — WITH CHECK must stop it (CLAUDE.md §5: negative isolation test per table).
describe('cross-tenant writes are rejected by WITH CHECK', () => {
  const asA = (statement: string) =>
    database.withTenant(TENANT.A.company, (tx) => tx.execute(statement), { userId: USER });
  const rlsViolation = { cause: { code: '42501' } };

  it('outbox', async () => {
    await expect(
      asA(`INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload)
           VALUES ('${TENANT.B.company}', '${nextId()}', 'business', '${TENANT.B.business}', 'BusinessCreated', '{}')`),
    ).rejects.toMatchObject(rlsViolation);
  });

  it('audit_log', async () => {
    await expect(
      asA(`INSERT INTO audit_log (company_id, id, entity, entity_id, action)
           VALUES ('${TENANT.B.company}', '${nextId()}', 'business', '${TENANT.B.business}', 'created')`),
    ).rejects.toMatchObject(rlsViolation);
  });

  it('idempotency_keys, in both scopes', async () => {
    const insert = (scope: string, scopeId: string, companyId: string, userId: string) =>
      asA(`INSERT INTO idempotency_keys
             (scope_type, scope_id, company_id, user_id, operation, key, request_fingerprint, expires_at)
           VALUES ('${scope}', '${scopeId}', ${companyId}, ${userId}, 'create-business', 'k-${nextId()}',
                   '${'d'.repeat(64)}', now() + interval '1 day')`);
    const other = '01930000-0000-7000-8000-0000000000ee';
    await expect(
      insert('COMPANY', TENANT.B.company, `'${TENANT.B.company}'`, 'NULL'),
    ).rejects.toMatchObject(rlsViolation);
    await expect(insert('USER', other, 'NULL', `'${other}'`)).rejects.toMatchObject(rlsViolation);
  });
});
