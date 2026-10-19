import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { createDatabase, type ClaimedEvent, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { buildObjectKey, createS3Storage } from '@pospay/storage';
import { createTestDatabase, type TestDatabase } from '../../../packages/db/test/test-database.ts';
import { PROVISIONAL_PLAN_ID } from '../../../packages/db/src/seed.ts';
import { seedTwoTenants, TENANT, USER } from '../../../packages/db/test/tenancy-fixtures.ts';
import { fakeCredentials, fakeS3 } from '../../../packages/storage/test/fake-s3.ts';
import { createDeliverer } from './outbox/deliver.ts';
import { retireBusinessLogoConsumer } from './modules/files/events/handlers/on-business-logo-changed.ts';
import { logoReference } from './modules/files/persistence/logo-reference.ts';
import { logoRetirementStore } from './modules/files/persistence/logo-retirement.ts';
import { retentionRepository } from './modules/files/persistence/retention.repository.ts';
import { CleanupFiles } from './modules/files/use-cases/cleanup-files/cleanup-files.ts';
import { RetireBusinessLogo } from './modules/files/use-cases/retire-business-logo/retire-business-logo.ts';

const ids = systemUuidV7();
let testDb: TestDatabase, db: Database, owner: postgres.Sql;
let fake: Awaited<ReturnType<typeof fakeS3>>, storage: ReturnType<typeof createS3Storage>;
let tenant: { company: string; business: string };
let now: Date;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  fake = await fakeS3();
  storage = createS3Storage({
    endpoint: fake.endpoint,
    region: 'auto',
    bucket: 'private',
    ...fakeCredentials,
  });
});
beforeEach(() => {
  now = new Date('2026-10-10T12:00:00Z');
  tenant = { company: ids.newId(), business: ids.newId() };
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  storage?.close();
  await fake?.close();
  await testDb?.drop();
});

async function company() {
  await owner`INSERT INTO companies(id, owner_user_id, plan_id, name_en) VALUES (${tenant.company},${USER},${PROVISIONAL_PLAN_ID},'Logo retire')`;
  await owner`INSERT INTO businesses(company_id,id,vertical_type,name_en) VALUES (${tenant.company},${tenant.business},'salon','Logo retire')`;
}
async function readyFile(target = tenant) {
  const id = ids.newId();
  const staging = buildObjectKey(target.company, target.business, id, 'staging');
  const published = buildObjectKey(target.company, target.business, id, 'verified');
  await owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,staging_key,storage_key,content_type,size_bytes,required_permission,created_by,created_at,status)
    VALUES (${target.company},${id},${target.business},'settings',${target.business},${staging},${published},'image/png',10,'read:settings:business',${USER},${now},'READY')`;
  await storage.put(staging, new Uint8Array(10), 'image/png');
  await storage.put(published, new Uint8Array(10), 'image/png');
  return { id, staging, published };
}
async function staffDocument() {
  const id = ids.newId();
  const staging = buildObjectKey(tenant.company, tenant.business, id, 'staging');
  const published = buildObjectKey(tenant.company, tenant.business, id, 'verified');
  await owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,staging_key,storage_key,content_type,size_bytes,required_permission,created_by,created_at,status)
    VALUES (${tenant.company},${id},${tenant.business},'staff',${id},${staging},${published},'image/png',10,'read:files:business',${USER},${now},'READY')`;
  await storage.put(staging, new Uint8Array(10), 'image/png');
  await storage.put(published, new Uint8Array(10), 'image/png');
  return { id, staging, published };
}
async function bind(fileId: string | null) {
  await owner`INSERT INTO business_settings (company_id, business_id, logo_file_id)
    VALUES (${tenant.company}, ${tenant.business}, ${fileId})
    ON CONFLICT (company_id, business_id) DO UPDATE SET logo_file_id = EXCLUDED.logo_file_id`;
}
function pipeline() {
  const clock = { now: () => now };
  const consumer = retireBusinessLogoConsumer(
    new RetireBusinessLogo(logoRetirementStore(), logoReference(), clock),
  );
  const deliver = createDeliverer(db, [consumer], createLogger('silent'), {
    knownEventTypes: ['BusinessLogoChanged'],
  });
  return { consumer, deliver };
}
function logoEvent(previous: string | null, fileId: string | null, id = ids.newId()): ClaimedEvent {
  return {
    companyId: tenant.company,
    id,
    aggregateId: tenant.business,
    aggregateType: 'business',
    eventType: 'BusinessLogoChanged',
    payload: { business_id: tenant.business, previous_file_id: previous, file_id: fileId },
    attempt: 1,
  };
}
function cleanup(target = storage) {
  return new CleanupFiles(retentionRepository(db, ids), target, ids, { now: () => now });
}
async function marker(id: string) {
  const [row] = await owner`SELECT purge_started_at, purged_at FROM file_objects
    WHERE company_id = ${tenant.company} AND id = ${id}`;
  return row;
}
async function audit(id: string) {
  const [row] = await owner`SELECT actor_user_id, after FROM audit_log
    WHERE entity_id = ${id} AND action = 'retention.deleted'`;
  return row;
}

it('does not retire a file the business still references', async () => {
  await company();
  const file = await readyFile();
  await bind(file.id);
  const { deliver } = pipeline();
  expect(await deliver(logoEvent(file.id, ids.newId()))).toEqual({ delivered: true });
  expect((await marker(file.id))?.['purge_started_at']).toBeNull();
  expect(await cleanup().execute(tenant.company, 'retired')).toBe(0);
  expect(fake.objects.has(file.staging)).toBe(true);
  expect(fake.objects.has(file.published)).toBe(true);
});

it('treats a replayed event as a no-op and ignores a second handle', async () => {
  await company();
  const file = await readyFile();
  await bind(null);
  const { consumer, deliver } = pipeline();
  const event = logoEvent(file.id, null);
  expect(await deliver(event)).toEqual({ delivered: true });
  const first = await marker(file.id);
  expect(first?.['purge_started_at']).not.toBeNull();
  expect(first?.['purged_at']).toBeNull();
  expect(await deliver(event)).toEqual({ delivered: true });
  expect(await marker(file.id)).toEqual(first);
  const [consumed] = await owner`SELECT count(*)::int AS n FROM consumed_events
    WHERE company_id = ${tenant.company} AND consumer_id = ${consumer.id} AND event_id = ${event.id}`;
  expect(consumed?.['n']).toBe(1);
  await db.withTenant(tenant.company, (tx) => consumer.handle(tx, logoEvent(file.id, null)));
  expect(await marker(file.id)).toEqual(first);
  expect(fake.objects.has(file.published)).toBe(true);
});

it('resumes after a crash between the marker and the storage delete', async () => {
  await company();
  const file = await readyFile();
  const pendingId = ids.newId();
  const pendingKey = buildObjectKey(tenant.company, tenant.business, pendingId, 'staging');
  const aged = new Date(now.getTime() - 25 * 60 * 60 * 1000);
  await owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,staging_key,content_type,size_bytes,required_permission,created_by,created_at,status)
    VALUES (${tenant.company},${pendingId},${tenant.business},'staff',${pendingId},${pendingKey},'application/pdf',10,'read:files:business',${USER},${aged},'PENDING')`;
  await storage.put(pendingKey, new Uint8Array(10), 'application/pdf');
  await bind(null);
  const { deliver } = pipeline();
  expect(await deliver(logoEvent(file.id, null))).toEqual({ delivered: true });
  expect(await cleanup().execute(tenant.company, 'retired')).toBe(1);
  expect(fake.objects.has(pendingKey)).toBe(true);
  expect((await marker(pendingId))?.['purge_started_at']).toBeNull();
  expect(fake.objects.has(file.published)).toBe(false);
  expect(fake.objects.has(file.staging)).toBe(false);
  expect((await marker(file.id))?.['purged_at']).not.toBeNull();
  expect(await cleanup().execute(tenant.company, 'abandoned')).toBe(1);
  expect(fake.objects.has(pendingKey)).toBe(false);
  const row = await audit(file.id);
  expect(row?.['actor_user_id']).toBeNull();
  expect(JSON.stringify(row)).toContain('retired');
  expect(JSON.stringify(row)).not.toContain(file.published);
  expect(JSON.stringify(row)).not.toContain(file.staging);
  expect(await cleanup().execute(tenant.company, 'retired')).toBe(0);
});

it('keeps the row for retry when storage deletion fails', async () => {
  await company();
  const file = await readyFile();
  await bind(null);
  const { deliver } = pipeline();
  expect(await deliver(logoEvent(file.id, null))).toEqual({ delivered: true });
  let fail = true;
  const useCase = cleanup({
    ...storage,
    remove: async (key) => {
      if (fail) throw new Error('STORAGE_UNAVAILABLE');
      await storage.remove(key);
    },
  });
  await expect(useCase.execute(tenant.company, 'retired')).rejects.toThrow('STORAGE_UNAVAILABLE');
  expect((await marker(file.id))?.['purged_at']).toBeNull();
  expect(fake.objects.has(file.published)).toBe(true);
  expect(fake.objects.has(file.staging)).toBe(true);
  expect(await audit(file.id)).toBeUndefined();
  expect(await useCase.execute(tenant.company, 'retired')).toBe(0);
  fail = false;
  now = new Date(now.getTime() + 20 * 60 * 1000);
  expect(await useCase.execute(tenant.company, 'retired')).toBe(1);
  expect(fake.objects.has(file.published)).toBe(false);
  expect(fake.objects.has(file.staging)).toBe(false);
  expect(await useCase.execute(tenant.company, 'retired')).toBe(0);
});

it('finishes on the next run when staging deletion fails after the published object is gone', async () => {
  await company();
  const file = await readyFile();
  await bind(null);
  const { deliver } = pipeline();
  expect(await deliver(logoEvent(file.id, null))).toEqual({ delivered: true });
  let failStaging = true;
  const useCase = cleanup({
    ...storage,
    remove: async (key) => {
      if (failStaging && key === file.staging) throw new Error('STORAGE_UNAVAILABLE');
      await storage.remove(key);
    },
  });
  await expect(useCase.execute(tenant.company, 'retired')).rejects.toThrow('STORAGE_UNAVAILABLE');
  expect(fake.objects.has(file.published)).toBe(false);
  expect(fake.objects.has(file.staging)).toBe(true);
  expect((await marker(file.id))?.['purged_at']).toBeNull();
  expect(await audit(file.id)).toBeUndefined();
  expect(await useCase.execute(tenant.company, 'retired')).toBe(0);
  failStaging = false;
  now = new Date(now.getTime() + 20 * 60 * 1000);
  expect(await useCase.execute(tenant.company, 'retired')).toBe(1);
  expect(fake.objects.has(file.staging)).toBe(false);
  expect((await marker(file.id))?.['purged_at']).not.toBeNull();
  expect(await audit(file.id)).toBeDefined();
});

it('does not audit again when the same event arrives after the tombstone', async () => {
  await company();
  const file = await readyFile();
  await bind(null);
  const { consumer, deliver } = pipeline();
  const event = logoEvent(file.id, null);
  expect(await deliver(event)).toEqual({ delivered: true });
  expect(await cleanup().execute(tenant.company, 'retired')).toBe(1);
  expect((await marker(file.id))?.['purged_at']).not.toBeNull();
  expect(await deliver(event)).toEqual({ delivered: true });
  await db.withTenant(tenant.company, (tx) => consumer.handle(tx, logoEvent(file.id, null)));
  const [audits] = await owner`SELECT count(*)::int AS n FROM audit_log
    WHERE entity_id = ${file.id} AND action = 'retention.deleted'`;
  expect(audits?.['n']).toBe(1);
  expect(await cleanup().execute(tenant.company, 'retired')).toBe(0);
});

it('does not retire a staff document of the same company', async () => {
  await company();
  const document = await staffDocument();
  await bind(null);
  const { deliver } = pipeline();
  expect(await deliver(logoEvent(document.id, null))).toEqual({ delivered: true });
  expect((await marker(document.id))?.['purge_started_at']).toBeNull();
  expect(await cleanup().execute(tenant.company, 'retired')).toBe(0);
  expect(fake.objects.has(document.staging)).toBe(true);
  expect(fake.objects.has(document.published)).toBe(true);
});

it('ignores a first bind and a foreign file', async () => {
  await company();
  const foreign = await readyFile(TENANT.B);
  const { deliver } = pipeline();
  expect(await deliver(logoEvent(null, ids.newId()))).toEqual({ delivered: true });
  const [settings] = await owner`SELECT 1 AS n FROM business_settings
    WHERE company_id = ${tenant.company} AND business_id = ${tenant.business}`;
  expect(settings).toBeUndefined();
  expect(await deliver(logoEvent(foreign.id, null))).toEqual({ delivered: true });
  const [foreignRow] = await owner`SELECT purge_started_at FROM file_objects
    WHERE company_id = ${TENANT.B.company} AND id = ${foreign.id}`;
  expect(foreignRow?.['purge_started_at']).toBeNull();
  expect(fake.objects.has(foreign.published)).toBe(true);
});

it('fails a malformed payload without a marker', async () => {
  await company();
  const file = await readyFile();
  const { deliver } = pipeline();
  const outcome = await deliver({
    ...logoEvent(file.id, null),
    payload: { business_id: tenant.business },
  });
  expect(outcome.delivered).toBe(false);
  expect((await marker(file.id))?.['purge_started_at']).toBeNull();
});

it('re-checks the logo under the settings lock before writing the marker', async () => {
  await company();
  const file = await readyFile();
  await bind(null);
  const blocker = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  const observer = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await blocker`BEGIN`;
  await blocker`SELECT business_id FROM business_settings
    WHERE company_id = ${tenant.company} AND business_id = ${tenant.business} FOR UPDATE`;
  const pending = pipeline().deliver(logoEvent(file.id, null));
  try {
    await vi.waitFor(
      async () => {
        const waiting = await observer`SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%business_settings%'`;
        expect(waiting.length).toBeGreaterThan(0);
      },
      { timeout: 5000, interval: 20 },
    );
    await blocker`UPDATE business_settings SET logo_file_id = ${file.id}
      WHERE company_id = ${tenant.company} AND business_id = ${tenant.business}`;
    await blocker`COMMIT`;
  } finally {
    await blocker.end();
    await observer.end();
    await pending.catch(() => undefined);
  }
  expect(await pending).toEqual({ delivered: true });
  expect((await marker(file.id))?.['purge_started_at']).toBeNull();
  expect(fake.objects.has(file.published)).toBe(true);
});
