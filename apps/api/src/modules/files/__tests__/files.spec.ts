import { expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { createFileQueue } from '../persistence/queue.adapter.ts';
import { startVerificationProcessor } from '../../../../../worker/src/modules/files/jobs/verification.processor.ts';
import { verificationRepository } from '../../../../../worker/src/modules/files/persistence/verification.repository.ts';
import {
  fake,
  h,
  db,
  verifier,
  cookie,
  company,
  business,
  readerCookie,
  readerId,
  readerMembership,
  ids,
  jobs,
  pdf,
  input,
  upload,
  ready,
  grantRead,
} from './files.fixture.ts';

it('does not publish before verification and never exposes a staging key', async () => {
  const ticket = await upload();
  const status = await h.send('GET', `/v1/files/${ticket.id}`, { cookie, company });
  expect(status.status).toBe(200);
  expect(status.body['status']).toBe('PENDING');
  expect(status.body).not.toHaveProperty('storage_key');
  expect(
    (await h.send('POST', `/v1/files/${ticket.id}/download`, { cookie, company })).body['code'],
  ).toBe('FILE_NOT_READY');
  expect(
    (
      await h.send('POST', `/v1/businesses/${business}/files/uploads`, {
        cookie,
        company,
        body: { ...input(), storage_key: 'client-supplied' },
      })
    ).status,
  ).toBe(400);
});
it('publishes an independent verified key; replay of the PUT cannot overwrite it', async () => {
  const ticket = await ready();
  const status = await h.send('GET', `/v1/files/${ticket.id}`, { cookie, company });
  expect(status.body).toMatchObject({
    status: 'READY',
    content_type: 'application/pdf',
    size_bytes: pdf.length,
  });
  const key = status.body['storage_key'] as string;
  expect(key).toContain('/verified/');
  expect(key).not.toContain('/staging/');
  await fetch(ticket.url, {
    method: 'PUT',
    headers: { 'content-type': 'application/pdf' },
    body: Buffer.alloc(pdf.length, 65),
  });
  for (let i = 0; i < 2; i++) {
    const response = await h.send('POST', `/v1/files/${ticket.id}/download`, { cookie, company });
    expect(response.status).toBe(200);
    expect(
      Buffer.from(await (await fetch(response.body['download_url'] as string)).arrayBuffer()),
    ).toEqual(pdf);
  }
  const [count] =
    await h.owner`SELECT count(*)::int AS n FROM file_access_audit WHERE company_id = ${company} AND file_id = ${ticket.id} AND outcome = 'ALLOW'`;
  expect(count?.['n']).toBe(2);
  const [canonical] =
    await h.owner`SELECT count(*)::int AS n FROM audit_log WHERE company_id = ${company} AND entity_id = ${ticket.id} AND action = 'access'`;
  expect(canonical?.['n']).toBe(2);
  await verifier.execute(company, ticket.id);
  expect(
    (await h.send('GET', `/v1/files/${ticket.id}`, { cookie, company })).body['storage_key'],
  ).toBe(key);
});
it('rejects a lying MIME and does not permit confirmation by another user', async () => {
  const ticket = await upload();
  await fetch(ticket.url, {
    method: 'PUT',
    headers: { 'content-type': 'application/pdf' },
    body: Buffer.alloc(pdf.length, 65),
  });
  expect(
    (await h.send('POST', `/v1/files/${ticket.id}/confirm`, { cookie: readerCookie, company }))
      .status,
  ).toBe(403);
  await verifier.execute(company, ticket.id);
  const response = await h.send('GET', `/v1/files/${ticket.id}`, { cookie, company });
  expect(response.body).toMatchObject({
    status: 'REJECTED',
    rejection_code: 'FILE_TYPE_INVALID',
  });
  expect(response.body).not.toHaveProperty('storage_key');
  expect(
    (await h.send('POST', `/v1/files/${ticket.id}/download`, { cookie, company })).status,
  ).toBe(409);
});
it('checks stored permission live, then DENY, expiry and membership removal; audits refusal', async () => {
  const ticket = await ready();
  const path = `/v1/files/${ticket.id}/download`;
  expect((await h.send('POST', path, { cookie: readerCookie, company })).status).toBe(404);
  await grantRead();
  expect((await h.send('POST', path, { cookie: readerCookie, company })).status).toBe(200);
  const deny = ids.newId();
  await h.owner`INSERT INTO permission_overrides (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${company},${deny},${readerMembership},'read:files:business','DENY','BUSINESS',${business},'synthetic deny',${readerId})`;
  expect((await h.send('POST', path, { cookie: readerCookie, company })).status).toBe(404);
  await h.owner`UPDATE permission_overrides SET expires_at = now() - interval '1 second' WHERE company_id = ${company} AND membership_id = ${readerMembership}`;
  expect((await h.send('POST', path, { cookie: readerCookie, company })).status).toBe(404);
  await grantRead();
  expect((await h.send('POST', path, { cookie: readerCookie, company })).status).toBe(200);
  await h.owner`UPDATE memberships SET ends_at = now() - interval '1 second' WHERE company_id = ${company} AND id = ${readerMembership}`;
  expect((await h.send('POST', path, { cookie: readerCookie, company })).status).toBe(403);
  const rows =
    await h.owner`SELECT outcome FROM file_access_audit WHERE company_id = ${company} AND file_id = ${ticket.id} AND actor_user_id = ${readerId} ORDER BY accessed_at`;
  expect(rows.map((row) => row['outcome'])).toEqual(['DENY', 'ALLOW', 'DENY', 'DENY', 'ALLOW']);
});
it('isolates object ids and scope at the API and worker boundaries', async () => {
  const ticket = await ready();
  const otherCompany = await h.onboard(cookie, 'Synthetic company B');
  expect(
    (await h.send('GET', `/v1/files/${ticket.id}`, { cookie, company: otherCompany })).status,
  ).toBe(404);
  expect(
    (await h.send('POST', `/v1/files/${ticket.id}/confirm`, { cookie, company: otherCompany }))
      .status,
  ).toBe(404);
  expect(
    (await h.send('POST', `/v1/files/${ticket.id}/download`, { cookie, company: otherCompany }))
      .status,
  ).toBe(404);
  const reads = fake.requests.length;
  await verifier.execute(otherCompany, ticket.id);
  expect(fake.requests.length).toBe(reads);
  expect(
    (
      await h.send('POST', `/v1/businesses/${business}/files/uploads`, {
        cookie,
        company: otherCompany,
        body: input(),
      })
    ).status,
  ).toBe(403);
});
it('metadata query projects its contract shape and uses the tenant primary-key index', async () => {
  const ticket = await ready();
  await h.owner`INSERT INTO file_objects (company_id,id,business_id,owner_module,owner_entity_id,staging_key,content_type,size_bytes,required_permission,created_by,created_at)
    SELECT ${company}, ('01920000-0000-7000-8000-' || lpad(to_hex(g),12,'0'))::uuid, ${business}, 'staff', ${ticket.id},
      'synthetic-plan-' || g, 'application/pdf', 10, 'read:files:business', ${readerId}, now() FROM generate_series(20000,20999) g`;
  await h.owner`ANALYZE file_objects`;
  const plan = await db.withTenant(company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan = off`);
    return tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) SELECT id,status,content_type,size_bytes,storage_key,rejection_code,
      business_id,branch_id,created_by,required_permission FROM file_objects WHERE company_id = ${company} AND id = ${ticket.id}`);
  });
  expect(JSON.stringify(plan)).toContain('file_objects_pkey');
  expect(
    Object.keys((await h.send('GET', `/v1/files/${ticket.id}`, { cookie, company })).body).sort(),
  ).toEqual(['content_type', 'id', 'size_bytes', 'status', 'storage_key']);
});

it('transports an id-only confirmation through isolated real BullMQ and the verification processor', async () => {
  const prefix = `files-test-${ids.newId()}`;
  const options = h.redis.options;
  const redisUrl = `redis://:${encodeURIComponent(options.password ?? '')}@${options.host}:${options.port}`;
  const queue = createFileQueue(h.redis, prefix);
  const processor = startVerificationProcessor(verifier, redisUrl, prefix);
  try {
    const ticket = await upload();
    await fetch(ticket.url, {
      method: 'PUT',
      headers: { 'content-type': 'application/pdf' },
      body: pdf,
    });
    expect(
      (await h.send('POST', `/v1/files/${ticket.id}/confirm`, { cookie, company })).status,
    ).toBe(202);
    const job = jobs.at(-1);
    expect(job).toEqual({ companyId: company, fileId: ticket.id });
    await queue.port.enqueue(company, ticket.id);
    await vi.waitFor(
      async () => {
        expect(
          (await h.send('GET', `/v1/files/${ticket.id}`, { cookie, company })).body['status'],
        ).toBe('READY');
      },
      { timeout: 10000, interval: 50 },
    );
  } finally {
    await processor.close();
    await queue.close();
    const connection = h.redis.duplicate({ keyPrefix: '' });
    const cleanup = new Queue('files-verify', { connection, prefix });
    try {
      await cleanup.obliterate({ force: true });
    } finally {
      await cleanup.close();
      connection.disconnect();
    }
  }
});

it('refuses an unverified branch reference without publishing an object or returning an internal error', async () => {
  const response = await h.send('POST', `/v1/businesses/${business}/files/uploads`, {
    cookie,
    company,
    body: { ...input(), branch_id: ids.newId() },
  });
  expect(response.status).toBe(403);
  expect(response.body['code']).toBe('FORBIDDEN');
});

it('fences concurrent verifiers and recovers expired leases without allowing stale publication', async () => {
  const ticket = await upload();
  const repository = verificationRepository(db);
  const at = new Date('2026-10-03T00:00:00Z');
  const first = ids.newId(),
    second = ids.newId();
  const until = new Date(at.getTime() + 120000);
  expect(await repository.claim(company, ticket.id, first, at, until)).not.toBeNull();
  await expect(repository.claim(company, ticket.id, second, at, until)).rejects.toThrow(
    'FILE_VERIFICATION_RETRY',
  );
  const later = new Date(until.getTime() + 1);
  expect(
    await repository.claim(company, ticket.id, second, later, new Date(later.getTime() + 120000)),
  ).not.toBeNull();
  const candidate = {
    key: `${company}/${business}/verified/${ids.newId()}`,
    type: 'application/pdf',
    size: pdf.length,
  };
  expect(await repository.complete(company, ticket.id, first, candidate, later)).toBe(false);
  await repository.release(company, ticket.id, first);
  expect((await h.send('GET', `/v1/files/${ticket.id}`, { cookie, company })).body['status']).toBe(
    'VERIFYING',
  );
  expect(
    await repository.reserve(
      company,
      ticket.id,
      second,
      ids.newId(),
      candidate.key,
      later,
      new Date(later.getTime() + 120000),
    ),
  ).toBe(true);
  expect(await repository.complete(company, ticket.id, second, candidate, later)).toBe(true);
  expect(await repository.claim(company, ticket.id, first, later, until)).toBeNull();
});

it('opens a staff document using its stored object key and never resolves another company’s key', async () => {
  const ticket = await ready();
  const key = (await h.send('GET', `/v1/files/${ticket.id}`, { cookie, company })).body[
    'storage_key'
  ];
  const response = await h.send('POST', '/v1/files/download', {
    cookie,
    company,
    body: { storage_key: key },
  });
  expect(response.status).toBe(200);
  expect(
    Buffer.from(await (await fetch(response.body['download_url'] as string)).arrayBuffer()),
  ).toEqual(pdf);
  const [audit] =
    await h.owner`SELECT count(*)::int AS n FROM file_access_audit WHERE company_id = ${company} AND file_id = ${ticket.id}`;
  expect(audit?.['n']).toBe(1);
  expect(
    (
      await h.send('POST', '/v1/files/download', {
        cookie: readerCookie,
        company,
        body: { storage_key: key },
      })
    ).status,
  ).toBe(404);
  const otherCompany = await h.onboard(cookie, 'Synthetic key isolation');
  expect(
    (
      await h.send('POST', '/v1/files/download', {
        cookie,
        company: otherCompany,
        body: { storage_key: key },
      })
    ).status,
  ).toBe(404);
});
