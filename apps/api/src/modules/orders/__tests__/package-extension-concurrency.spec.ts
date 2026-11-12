import postgres from 'postgres';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { ids, type SessionFixture } from './session.fixture.ts';
import {
  extensionBody,
  packageExtensionFixture,
  postExtension,
  readExtensionAudits,
  readExtensions,
  seedSoldPackage,
} from './package-extension.fixture.ts';

let f: SessionFixture;

beforeAll(async () => {
  f = (await packageExtensionFixture()).f;
});

afterAll(async () => {
  await f?.close();
});

function barrier() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

it('two different keys with one expected expiry produce one 201 and one stale 409', async () => {
  const seeded = await seedSoldPackage(f, { sessions: 1, expiresOn: '2026-12-30' });
  const locked = barrier();
  const release = barrier();
  const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  const blocker = f.h.owner.begin(async (write) => {
    await write`SELECT id FROM package_entitlements WHERE id=${seeded.entitlement} FOR UPDATE`;
    locked.release();
    await release.promise;
  });
  let pending: Promise<PromiseSettledResult<Awaited<ReturnType<typeof postExtension>>>[]> | undefined;
  try {
    await locked.promise;
    const requests = Promise.allSettled([
      postExtension(f, seeded.entitlement, { key: ids.newId() }),
      postExtension(f, seeded.entitlement, { key: ids.newId() }),
    ]);
    pending = requests;
    await vi.waitFor(async () => {
      const waiting = await observer`SELECT pid FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock'
          AND query LIKE '%package_entitlements%'`;
      expect(waiting.length).toBeGreaterThan(0);
    });
    release.release();
    await blocker;
    const outcomes = await requests;
    const statuses = outcomes.map((outcome) =>
      outcome.status === 'fulfilled' ? outcome.value.status : 0,
    );
    expect(statuses.sort()).toEqual([201, 409]);
    const stale = outcomes.find(
      (outcome) => outcome.status === 'fulfilled' && outcome.value.status === 409,
    );
    expect(stale).toMatchObject({ value: { body: { code: 'PACKAGE_EXPIRY_STALE' } } });
  } finally {
    release.release();
    await blocker;
    await pending?.catch(() => undefined);
    await observer.end();
  }
  expect(await readExtensions(f, seeded.entitlement)).toHaveLength(1);
  expect(await readExtensionAudits(f, seeded.entitlement)).toHaveLength(1);
});

it('two simultaneous requests with the same key and body return one identical replay', async () => {
  const seeded = await seedSoldPackage(f, { sessions: 1, expiresOn: '2026-12-30' });
  const key = ids.newId();
  const body = extensionBody();
  const [first, second] = await Promise.all([
    postExtension(f, seeded.entitlement, { key, body }),
    postExtension(f, seeded.entitlement, { key, body }),
  ]);
  expect(first.status).toBe(201);
  expect(second.status).toBe(201);
  expect(second.body).toEqual(first.body);
  expect(await readExtensions(f, seeded.entitlement)).toHaveLength(1);
  expect(await readExtensionAudits(f, seeded.entitlement)).toHaveLength(1);
});
