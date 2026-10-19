import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { errorEnvelope } from '@pospay/contracts';
import { lockBusinessLogoReference } from '@pospay/db';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { permissionFixture, type PermissionFixture } from '../../../../test/permissions-fixture.ts';
import {
  insertLogoFile,
  logoAudits,
  logoEvents,
  type LogoReply,
} from './set-business-logo.support.ts';

const SETTINGS_READY =
  "owner_module = 'settings' AND owner_entity_id = ${businessId} AND status = 'READY'";
const STILL_FREE = 'purge_started_at IS NULL AND purged_at IS NULL';
const retiredAt = new Date('2026-10-10T12:00:00Z');

let f: PermissionFixture;

beforeAll(async () => {
  f = await permissionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
beforeEach(async () => {
  await f.h.owner`UPDATE business_settings SET logo_file_id = NULL
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  await f.h.redis.del(`settings:${f.company}:${f.business}:generation`);
});

const put = (body: object) =>
  f.h.app.inject({
    method: 'PUT',
    url: `/v1/businesses/${f.business}/settings/logo`,
    headers: { cookie: f.cookie, 'x-company-id': f.company },
    payload: body,
  });

async function lockSettingsRow(blocker: postgres.Sql): Promise<void> {
  // الصف بيتسجل قبل القفل: الربط ما بيعملش INSERT لو الصف ظاهر، والانتظار يفضل جوه قفل المرجع.
  await blocker`INSERT INTO business_settings (company_id, business_id)
    VALUES (${f.company}, ${f.business})
    ON CONFLICT (company_id, business_id) DO NOTHING`;
  await blocker`BEGIN`;
  await blocker`SELECT business_id FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business} FOR UPDATE`;
}

async function waitForQueuedBinds(observer: postgres.Sql): Promise<void> {
  await vi.waitFor(
    async () => {
      // الربط التاني بيستنى قفل العضوية بتاع الأول، فصف الإعدادات عليه مستني واحد بس.
      const waiting = await observer`SELECT query FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND (query LIKE '%business_settings%' OR query LIKE '%memberships%'
            OR query LIKE '%companies%' OR query LIKE '%businesses%')`;
      const onSettings = waiting.filter((row) =>
        String(row['query']).includes('business_settings'),
      );
      expect(waiting.length).toBeGreaterThanOrEqual(2);
      expect(onSettings.length).toBeGreaterThanOrEqual(1);
    },
    { timeout: 8000, interval: 20 },
  );
}

async function waitForSettingsLocks(observer: postgres.Sql, count: number): Promise<void> {
  await vi.waitFor(
    async () => {
      const waiting = await observer`SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query LIKE '%business_settings%'`;
      expect(waiting.length).toBeGreaterThanOrEqual(count);
    },
    { timeout: 8000, interval: 20 },
  );
}

async function release(
  blocker: postgres.Sql,
  observer: postgres.Sql,
  pending: Promise<unknown>[],
): Promise<void> {
  try {
    await blocker`COMMIT`;
  } catch {
    await blocker`ROLLBACK`.catch(() => undefined);
  }
  await blocker.end();
  await observer.end();
  await Promise.allSettled(pending);
}

function workerFiles(name: string): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../../worker/src/modules/files',
    name,
  );
}

function assertRetirementStore(): void {
  const retirement = readFileSync(workerFiles('persistence/logo-retirement.ts'), 'utf8').replace(
    /\s+/g,
    ' ',
  );
  const reference = readFileSync(workerFiles('persistence/logo-reference.ts'), 'utf8');
  const decision = readFileSync(
    workerFiles('use-cases/retire-business-logo/retire-business-logo.ts'),
    'utf8',
  );
  expect(reference).toContain('lockBusinessLogoReference(tx, companyId, businessId, fileId)');
  expect(decision).toContain('this.logos.holds(tx, companyId, businessId, fileId)');
  expect(decision).toContain('if (!shouldRetireUnreferencedLogo(stillReferenced)) return;');
  expect(retirement).toContain(SETTINGS_READY);
  expect(retirement).toContain(STILL_FREE);
  expect(retirement).toContain('SELECT purge_started_at, purged_at FROM file_objects');
  expect(retirement).toContain('FOR UPDATE');
  expect(retirement).toContain('SET purge_started_at = ${at.toISOString()}::timestamptz');
}

function settingsReady(businessId: string) {
  const [before, after] = SETTINGS_READY.split('${businessId}');
  return sql`${sql.raw(before ?? '')}${businessId}${sql.raw(after ?? '')}`;
}

function retireUnreferenced(fileId: string): Promise<void> {
  assertRetirementStore();
  return f.db.withTenant(
    f.company,
    async (tx) => {
      const still = await lockBusinessLogoReference(tx, f.company, f.business, fileId);
      if (still) return;
      const [row] = await tx.execute<{
        purge_started_at: string | null;
        purged_at: string | null;
      }>(sql`
        SELECT purge_started_at, purged_at FROM file_objects
        WHERE company_id = ${f.company} AND id = ${fileId}
          AND ${settingsReady(f.business)}
        FOR UPDATE`);
      if (row === undefined || row.purge_started_at !== null || row.purged_at !== null) return;
      await tx.execute(sql`
        UPDATE file_objects SET purge_started_at = ${retiredAt.toISOString()}::timestamptz
        WHERE company_id = ${f.company} AND id = ${fileId}
          AND ${settingsReady(f.business)}
          AND ${sql.raw(STILL_FREE)}`);
    },
    { userId: f.userId },
  );
}

it('bind first: the consumer then sees the file referenced and marks nothing', async () => {
  const id = await insertLogoFile(f);
  const before = (await logoAudits(f)).length;
  const blocker = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  let bind: Promise<LogoReply> | undefined;
  let retired: Promise<void> | undefined;
  try {
    await lockSettingsRow(blocker);
    bind = put({ file_id: id });
    await waitForSettingsLocks(observer, 1);
    retired = retireUnreferenced(id);
    await waitForSettingsLocks(observer, 2);
  } finally {
    await release(
      blocker,
      observer,
      [bind, retired].filter((job) => job !== undefined),
    );
  }
  const res = await bind;
  await retired;
  const [row] = await f.h.owner`SELECT logo_file_id FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  const [file] = await f.h.owner`SELECT purge_started_at FROM file_objects
    WHERE company_id = ${f.company} AND id = ${id}`;
  expect(res?.statusCode).toBe(200);
  expect(row?.['logo_file_id']).toBe(id);
  expect(file?.['purge_started_at']).toBeNull();
  expect(await logoAudits(f)).toHaveLength(before + 1);
});

it('retire first: the bind is refused because purge has started', async () => {
  const id = await insertLogoFile(f);
  const before = (await logoAudits(f)).length;
  const blocker = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  let retired: Promise<void> | undefined;
  let bind: Promise<LogoReply> | undefined;
  try {
    await lockSettingsRow(blocker);
    retired = retireUnreferenced(id);
    await waitForSettingsLocks(observer, 1);
    bind = put({ file_id: id });
    await waitForSettingsLocks(observer, 2);
  } finally {
    await release(
      blocker,
      observer,
      [retired, bind].filter((job) => job !== undefined),
    );
  }
  await retired;
  const res = await bind;
  const [row] = await f.h.owner`SELECT logo_file_id FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  const [file] = await f.h.owner`SELECT purge_started_at FROM file_objects
    WHERE company_id = ${f.company} AND id = ${id}`;
  expect(res?.statusCode).toBe(404);
  expect(errorEnvelope.parse(res?.json()).code).toBe('FILE_NOT_FOUND');
  expect(row?.['logo_file_id']).toBeNull();
  expect(file?.['purge_started_at']).not.toBeNull();
  expect(await logoAudits(f)).toHaveLength(before);
});

it('two binds of different files both commit, and the later event names the earlier file', async () => {
  const first = await insertLogoFile(f);
  const second = await insertLogoFile(f);
  const before = (await logoEvents(f)).length;
  const blocker = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  let left: Promise<LogoReply> | undefined;
  let right: Promise<LogoReply> | undefined;
  try {
    await lockSettingsRow(blocker);
    left = put({ file_id: first });
    right = put({ file_id: second });
    await waitForQueuedBinds(observer);
  } finally {
    await release(
      blocker,
      observer,
      [left, right].filter((job) => job !== undefined),
    );
  }
  expect((await left)?.statusCode).toBe(200);
  expect((await right)?.statusCode).toBe(200);
  const events = (await logoEvents(f)).slice(before);
  expect(events).toHaveLength(2);
  const earlier = events[0]?.['payload'] as { previous_file_id: string | null; file_id: string };
  const later = events[1]?.['payload'] as { previous_file_id: string | null; file_id: string };
  expect(earlier?.previous_file_id).toBeNull();
  expect(later?.previous_file_id).toBe(earlier?.file_id);
  expect([earlier?.file_id, later?.file_id].sort()).toEqual([first, second].sort());
  const [row] = await f.h.owner`SELECT logo_file_id FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  expect(row?.['logo_file_id']).toBe(later?.file_id);
});

it('two binds of the same file leave one event and one audit', async () => {
  const id = await insertLogoFile(f);
  const auditsBefore = (await logoAudits(f)).length;
  const eventsBefore = (await logoEvents(f)).length;
  const blocker = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  let left: Promise<LogoReply> | undefined;
  let right: Promise<LogoReply> | undefined;
  try {
    await lockSettingsRow(blocker);
    left = put({ file_id: id });
    right = put({ file_id: id });
    await waitForQueuedBinds(observer);
  } finally {
    await release(
      blocker,
      observer,
      [left, right].filter((job) => job !== undefined),
    );
  }
  expect((await left)?.statusCode).toBe(200);
  expect((await right)?.statusCode).toBe(200);
  expect(await logoEvents(f)).toHaveLength(eventsBefore + 1);
  expect(await logoAudits(f)).toHaveLength(auditsBefore + 1);
  const [row] = await f.h.owner`SELECT logo_file_id FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  expect(row?.['logo_file_id']).toBe(id);
});

it('a staff document of the same company is refused without locking its row', async () => {
  const staffId = await insertLogoFile(f, {
    ownerModule: 'staff',
    ownerEntityId: f.ids.newId(),
    requiredPermission: 'read:files:business',
  });
  const before = (await logoAudits(f)).length;
  const blocker = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  const probe = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  let request: Promise<LogoReply> | undefined;
  try {
    await lockSettingsRow(blocker);
    request = put({ file_id: staffId });
    await waitForSettingsLocks(observer, 1);
    await probe`BEGIN`;
    await probe`SELECT id FROM file_objects
      WHERE company_id = ${f.company} AND id = ${staffId} FOR UPDATE NOWAIT`;
    await blocker`COMMIT`;
    const pending = request;
    const res = await new Promise<LogoReply>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('PUT waited on the staff file lock')), 3000);
      void pending.then(resolve, reject).finally(() => clearTimeout(timer));
    });
    expect([res.statusCode, errorEnvelope.parse(res.json()).code]).toEqual([404, 'FILE_NOT_FOUND']);
  } finally {
    await probe`ROLLBACK`.catch(() => undefined);
    await probe.end();
    await release(
      blocker,
      observer,
      [request].filter((job) => job !== undefined),
    );
  }
  expect(await logoAudits(f)).toHaveLength(before);
});
