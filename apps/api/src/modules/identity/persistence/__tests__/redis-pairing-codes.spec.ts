import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testRedis } from '../../../../../test/harness.ts';
import type { PairingCodes } from '../../ports/devices.port.ts';
import { createRedisPairingCodes } from '../redis-pairing-codes.ts';

// أكواد الربط في Redis: إصدار كود جديد يلغي كود الفرع القديم، والشركة التانية ما بتأثرش على
// شركة، وطلب تسجيل واحد بس بيحجز الكود في نفس الوقت (spec 071 FR-001).
const clock = { now: () => new Date('2026-01-01T00:00:00.000Z') };
const COMPANY = '01920000-0000-7000-8000-0000000000a1';
const OTHER_COMPANY = '01920000-0000-7000-8000-0000000000a2';
const BRANCH = '01920000-0000-7000-8000-0000000000b1';
const OTHER_BRANCH = '01920000-0000-7000-8000-0000000000b2';

function redisUrl(): string {
  const configured = process.env['REDIS_URL'];
  if (configured !== undefined && configured !== '') return configured;
  const password = encodeURIComponent(process.env['REDIS_PASSWORD'] ?? '');
  return `redis://:${password}@${process.env['REDIS_HOST'] ?? '127.0.0.1'}:${process.env['REDIS_PORT'] ?? '6379'}`;
}

async function ready(client: Redis): Promise<void> {
  client.on('error', () => undefined);
  await new Promise<void>((resolve, reject) => {
    client.once('ready', resolve);
    client.once('error', reject);
  });
}

type PairingContext = {
  readonly codes: PairingCodes;
  readonly redis: Redis;
  readonly issue: (companyId: string, branchId: string) => Promise<{ code: string }>;
};

async function replacesLiveCode(ctx: PairingContext): Promise<void> {
  const first = await ctx.issue(COMPANY, BRANCH);
  const second = await ctx.issue(COMPANY, BRANCH);
  expect(second.code).not.toBe(first.code);
  expect(await ctx.codes.claim(first.code)).toBeNull();
  const claimed = await ctx.codes.claim(second.code);
  expect(claimed?.companyId).toBe(COMPANY);
  expect(claimed?.branchId).toBe(BRANCH);
}

async function ignoresUuidCase(ctx: PairingContext): Promise<void> {
  const first = await ctx.issue(COMPANY, BRANCH);
  const second = await ctx.issue(COMPANY.toUpperCase(), BRANCH.toUpperCase());
  expect(await ctx.codes.claim(first.code)).toBeNull();
  const claimed = await ctx.codes.claim(second.code);
  expect(claimed?.companyId).toBe(COMPANY);
  expect(claimed?.branchId).toBe(BRANCH);
}

async function isolatesCompaniesAndBranches(ctx: PairingContext): Promise<void> {
  const mine = await ctx.issue(COMPANY, BRANCH);
  const otherCompany = await ctx.issue(OTHER_COMPANY, BRANCH);
  const otherBranch = await ctx.issue(COMPANY, OTHER_BRANCH);
  expect((await ctx.codes.claim(mine.code))?.companyId).toBe(COMPANY);
  expect((await ctx.codes.claim(otherCompany.code))?.companyId).toBe(OTHER_COMPANY);
  expect((await ctx.codes.claim(otherBranch.code))?.branchId).toBe(OTHER_BRANCH);
  // استبدال كود الشركة التانية ما بيأثرش على كود الشركة الأولى ولا على كود الفرع التاني.
  const replaced = await ctx.issue(OTHER_COMPANY, BRANCH);
  expect(replaced.code).not.toBe(otherCompany.code);
  expect(await ctx.redis.get(`pairing:${otherCompany.code}`)).toBeNull();
  expect(await ctx.redis.get(`pairing:${mine.code}`)).toBe(`${COMPANY}|${BRANCH}`);
  expect(await ctx.redis.get(`pairing:${otherBranch.code}`)).toBe(`${COMPANY}|${OTHER_BRANCH}`);
}

async function reservesOneClaim(ctx: PairingContext): Promise<void> {
  const issued = await ctx.issue(COMPANY, BRANCH);
  const first = await ctx.codes.claim(issued.code);
  expect(first).not.toBeNull();
  expect(await ctx.codes.claim(issued.code)).toBeNull();
  if (first === null) throw new Error('the claim failed');
  await ctx.codes.release(issued.code, first.claimId);
  const second = await ctx.codes.claim(issued.code);
  expect(second).not.toBeNull();
  if (second === null) throw new Error('the second claim failed');
  expect(second.claimId).not.toBe(first.claimId);
}

async function refusesAReplacedCode(ctx: PairingContext): Promise<void> {
  const first = await ctx.issue(COMPANY, BRANCH);
  const claimed = await ctx.codes.claim(first.code);
  if (claimed === null) throw new Error('the claim failed');
  const second = await ctx.issue(COMPANY, BRANCH);
  expect(
    await ctx.codes.consume({
      code: first.code,
      companyId: COMPANY,
      branchId: BRANCH,
      claimId: claimed.claimId,
    }),
  ).toBe(false);
  // الحجز بتاع الطلب القديم اتفكّ، والكود الجديد لسه قابل للحجز والأكل.
  expect(await ctx.codes.claim(first.code)).toBeNull();
  const secondClaim = await ctx.codes.claim(second.code);
  if (secondClaim === null) throw new Error('the second claim failed');
  expect(
    await ctx.codes.consume({
      code: second.code,
      companyId: COMPANY,
      branchId: BRANCH,
      claimId: secondClaim.claimId,
    }),
  ).toBe(true);
  expect(await ctx.codes.claim(second.code)).toBeNull();
}

async function refusesMalformedCodes(ctx: PairingContext): Promise<void> {
  expect(await ctx.codes.claim('nope')).toBeNull();
  expect(await ctx.codes.claim('abcdefgh')).toBeNull();
}

async function reportsTheExpiry(ctx: PairingContext): Promise<void> {
  const issued = await ctx.codes.issue({ companyId: COMPANY, branchId: BRANCH });
  expect(issued.expiresAt.toISOString()).toBe('2026-01-01T00:10:00.000Z');
}

async function keepsKeysInsideThePrefix(ctx: PairingContext): Promise<void> {
  const prefix = typeof ctx.redis.options.keyPrefix === 'string' ? ctx.redis.options.keyPrefix : '';
  const issued = await ctx.issue(COMPANY, OTHER_BRANCH);
  expect(await ctx.redis.get(`pairing:${issued.code}`)).toBe(`${COMPANY}|${OTHER_BRANCH}`);
  expect(await ctx.redis.get(`pairing_branch:${COMPANY}:${OTHER_BRANCH}`)).toBe(issued.code);
  const keys = await ctx.redis.keys(`${prefix}pairing:*`);
  expect(keys.length).toBeGreaterThan(0);
  expect(keys.every((key) => key.startsWith(prefix))).toBe(true);
}

function pairingSuite(label: string, create: () => Redis): void {
  describe(label, () => {
    let redis: Redis;
    let codes: PairingCodes;
    const issuedCodes: string[] = [];
    const usedTargets: string[] = [];

    const issue = async (companyId: string, branchId: string) => {
      usedTargets.push(`${companyId}:${branchId}`);
      const issued = await codes.issue({ companyId, branchId });
      issuedCodes.push(issued.code);
      return issued;
    };

    beforeAll(async () => {
      redis = create();
      await ready(redis);
      codes = createRedisPairingCodes(redis, clock);
    });

    afterAll(async () => {
      const keys = [
        ...issuedCodes.map((code) => `pairing:${code}`),
        ...issuedCodes.map((code) => `pairing_inflight:${code}`),
        ...usedTargets.map((target) => `pairing_branch:${target}`),
      ];
      if (keys.length > 0) await redis.del(...keys);
      await redis.quit();
    });

    it('a new code replaces the branch’s live code', () =>
      replacesLiveCode({ codes, redis, issue }));
    it('a mixed-case UUID replaces the same branch’s lowercase pointer', () =>
      ignoresUuidCase({ codes, redis, issue }));
    it('another company and another branch keep their own live code', () =>
      isolatesCompaniesAndBranches({ codes, redis, issue }));
    it('only one registration claims a code, and releasing it frees the code', () =>
      reservesOneClaim({ codes, redis, issue }));
    it('a code replaced during a registration can never be consumed', () =>
      refusesAReplacedCode({ codes, redis, issue }));
    it('refuses a malformed code', () => refusesMalformedCodes({ codes, redis, issue }));
    it('reports the expiry ten minutes away', () => reportsTheExpiry({ codes, redis, issue }));
    it('keeps every key inside the client’s own key prefix', () =>
      keepsKeysInsideThePrefix({ codes, redis, issue }));
  });
}

pairingSuite('without a key prefix', () => new Redis(redisUrl()));
pairingSuite('with the harness key prefix', () => testRedis());
