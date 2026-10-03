import { expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { verificationRepository } from '../persistence/verification.repository.ts';
import { artifactRepository } from '../persistence/artifact.repository.ts';
import { CleanupFiles } from '../use-cases/cleanup-files/cleanup-files.ts';
import { CleanupArtifacts } from '../use-cases/cleanup-artifacts/cleanup-artifacts.ts';
import { retentionRepository } from '../persistence/retention.repository.ts';
import {
  company,
  business,
  now,
  ids,
  db,
  owner,
  storage,
  fake,
  pdf,
  clock,
  advance,
  cleanup,
  verifier,
  pendingFile,
  ownedCandidate,
  auditCount,
} from './artifacts.fixture.ts';

it('staging deletion failure is durable, and retry of a READY verification drains it', async () => {
  const file = await pendingFile();
  let fail = true;
  const target = {
    remove: async (key: string) => {
      if (fail) throw new Error('synthetic deletion failure');
      await storage.remove(key);
    },
  };
  const worker = verifier({}, storage, cleanup(target));
  await expect(worker.execute(company, file.id)).rejects.toThrow('FILE_ARTIFACT_CLEANUP_RETRY');
  const [row] =
    await owner`SELECT status,storage_key FROM file_objects WHERE company_id = ${company} AND id = ${file.id}`;
  expect(row?.['status']).toBe('READY');
  expect(fake.objects.has(file.key)).toBe(true);
  expect(await auditCount(file.id)).toBe(0);
  fail = false;
  await worker.execute(company, file.id);
  expect(fake.objects.has(file.key)).toBe(false);
  expect(fake.objects.has(row?.['storage_key'] as string)).toBe(true);
  expect(await auditCount(file.id)).toBe(1);
});

it('retention jobs remove replayed PUT bytes after expiry and preserve the verified object', async () => {
  const file = await pendingFile();
  await verifier().execute(company, file.id);
  const [row] =
    await owner`SELECT storage_key FROM file_objects WHERE company_id = ${company} AND id = ${file.id}`;
  const published = row?.['storage_key'] as string;
  expect(fake.objects.has(file.key)).toBe(false);
  expect(
    (
      await fetch(file.url, {
        method: 'PUT',
        headers: { 'content-type': 'application/pdf' },
        body: Buffer.alloc(pdf.length, 65),
      })
    ).status,
  ).toBe(200);
  expect(fake.objects.has(file.key)).toBe(true);
  expect(await cleanup().execute(company)).toBe(0);
  advance(121000);
  const scheduled = new CleanupFiles(retentionRepository(db, ids), storage, ids, clock, cleanup());
  await scheduled.execute(company, 'abandoned');
  expect(fake.objects.has(file.key)).toBe(false);
  expect(Buffer.from(await storage.read(published, pdf.length))).toEqual(pdf);
  expect(await cleanup().execute(company)).toBe(0);
  expect(await auditCount(file.id)).toBe(1);
});

it.each(['failure', 'lost lease', 'crash'] as const)(
  'owns the candidate before PUT and cleans it after publication %s',
  async (kind) => {
    const file = await pendingFile();
    let candidateKey = '';
    const target = {
      ...storage,
      put: async (key: string, bytes: Uint8Array, type: string) => {
        const rows =
          await owner`SELECT object_key FROM file_cleanup_objects WHERE company_id = ${company} AND file_id = ${file.id} AND object_key = ${key} AND state = 'OWNED'`;
        expect(rows).toHaveLength(1);
        candidateKey = key;
        await storage.put(key, bytes, type);
        if (kind === 'crash') throw new Error('synthetic crash after PUT');
      },
    };
    const repo = verificationRepository(db);
    const worker = verifier(
      {
        complete: async (...args) => {
          if (kind === 'failure') throw new Error('synthetic publication failure');
          await owner`UPDATE file_objects SET lease_id = ${ids.newId()} WHERE company_id = ${company} AND id = ${file.id}`;
          return repo.complete(...args);
        },
      },
      target,
    );
    if (kind === 'lost lease') await worker.execute(company, file.id);
    else await expect(worker.execute(company, file.id)).rejects.toThrow(/synthetic/);
    expect(fake.objects.has(candidateKey)).toBe(true);
    advance(22 * 60000);
    expect(await cleanup().execute(company)).toBe(1);
    expect(fake.objects.has(candidateKey)).toBe(false);
    expect(fake.objects.has(file.key)).toBe(true);
    expect(await auditCount(file.id)).toBe(1);
    expect(await cleanup().execute(company)).toBe(0);
  },
);

it('a cleanup claim permanently fences publication; a stale cleanup cannot acknowledge its replacement', async () => {
  const file = await pendingFile(),
    candidate = await ownedCandidate(file.id);
  await storage.put(candidate.key, pdf, 'application/pdf');
  advance(22 * 60000);
  const repo = artifactRepository(db, ids),
    first = ids.newId(),
    second = ids.newId();
  expect(await repo.claim(company, first, now, new Date(now.getTime() + 120000))).toHaveLength(1);
  await owner`UPDATE file_objects SET lease_until = ${new Date(now.getTime() + 120000)} WHERE company_id = ${company} AND id = ${file.id}`;
  expect(
    await verificationRepository(db).complete(
      company,
      file.id,
      candidate.leaseId,
      { key: candidate.key, type: 'application/pdf', size: pdf.length },
      now,
    ),
  ).toBe(false);
  advance(120000);
  expect(await repo.claim(company, second, now, new Date(now.getTime() + 120000))).toHaveLength(1);
  expect(await repo.complete(company, candidate.candidateId, first, now, now)).toBe(false);
  await storage.remove(candidate.key);
  expect(
    await repo.complete(
      company,
      candidate.candidateId,
      second,
      now,
      new Date(now.getTime() + 86400000),
    ),
  ).toBe(true);
  expect(
    await verificationRepository(db).complete(
      company,
      file.id,
      candidate.leaseId,
      { key: candidate.key, type: 'application/pdf', size: pdf.length },
      now,
    ),
  ).toBe(false);
  expect(await auditCount(file.id)).toBe(1);
});

it('a deleted candidate tombstone reconciles late writes without a second audit or published-key deletion', async () => {
  const file = await pendingFile(),
    candidate = await ownedCandidate(file.id);
  advance(22 * 60000);
  await cleanup().execute(company);
  await storage.put(candidate.key, pdf, 'application/pdf');
  advance(86400000);
  await cleanup().execute(company);
  expect(fake.objects.has(candidate.key)).toBe(false);
  expect(await auditCount(file.id)).toBe(1);
});

it('candidate deletion remains fenced across provider failure and crash after DELETE before acknowledgement', async () => {
  const file = await pendingFile(),
    candidate = await ownedCandidate(file.id);
  await storage.put(candidate.key, pdf, 'application/pdf');
  advance(22 * 60000);
  await expect(
    cleanup({
      remove: async () => {
        throw new Error('synthetic failure');
      },
    }).execute(company),
  ).rejects.toThrow('FILE_ARTIFACT_CLEANUP_RETRY');
  await owner`UPDATE file_objects SET lease_until = ${new Date(now.getTime() + 120000)} WHERE company_id = ${company} AND id = ${file.id}`;
  expect(
    await verificationRepository(db).complete(
      company,
      file.id,
      candidate.leaseId,
      { key: candidate.key, type: 'application/pdf', size: pdf.length },
      now,
    ),
  ).toBe(false);
  await verificationRepository(db).release(company, file.id, candidate.leaseId);
  const repo = artifactRepository(db, ids);
  const crash = new CleanupArtifacts(
    {
      ...repo,
      complete: async () => {
        throw new Error('synthetic lost ack');
      },
    },
    storage,
    ids,
    clock,
  );
  await expect(crash.execute(company)).rejects.toThrow('FILE_ARTIFACT_CLEANUP_RETRY');
  expect(fake.objects.has(candidate.key)).toBe(false);
  expect(await auditCount(file.id)).toBe(0);
  await cleanup().execute(company);
  expect(await auditCount(file.id)).toBe(1);
  expect(await cleanup().execute(company)).toBe(0);
});

it('bounds each cleanup batch at 50, skips published candidates and never reads/deletes another tenant', async () => {
  const file = await pendingFile();
  await verifier().execute(company, file.id);
  for (let i = 0; i < 51; i++) {
    const id = ids.newId(),
      key = `${company}/${business}/verified/${id}`;
    await owner`INSERT INTO file_cleanup_objects(company_id,id,file_id,object_key,kind,expiry_at,cleanup_after)
      VALUES (${company},${id},${file.id},${key},'CANDIDATE',${now},${now})`;
    await storage.put(key, pdf, 'application/pdf');
  }
  const io = fake.requests.length;
  expect(await cleanup().execute(TENANT.B.company)).toBe(0);
  expect(fake.requests).toHaveLength(io);
  expect(await cleanup().execute(company)).toBe(50);
  expect(await cleanup().execute(company)).toBe(1);
  const [published] =
    await owner`SELECT storage_key FROM file_objects WHERE company_id = ${company} AND id = ${file.id}`;
  expect(fake.objects.has(published?.['storage_key'] as string)).toBe(true);
  expect(
    await db.withTenant(TENANT.B.company, (tx) =>
      tx.execute(sql`SELECT id FROM file_cleanup_objects`),
    ),
  ).toHaveLength(0);
});
