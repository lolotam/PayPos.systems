import { IdempotencyKeyBusyError, IdempotencyKeyReusedError } from '@pospay/db';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  closeCommissionFixture,
  memberWithoutPlanPermission,
} from './commission-plan-versions.fixture.ts';
import {
  commissionServiceOverridesFixture,
  idempotencyClaims,
  overrideAndAuditCounts,
  overrideInput,
  runOverride,
  type CommissionServiceOverrideFixture,
} from './commission-service-overrides.fixture.ts';

let f: CommissionServiceOverrideFixture;
beforeAll(async () => {
  f = await commissionServiceOverridesFixture();
});
afterAll(async () => {
  await closeCommissionFixture(f);
});

it('the same body with the same key replays once and writes one row and one audit', async () => {
  const first = await runOverride(f, overrideInput(f), 'cm-replay-same');
  const replay = await runOverride(f, overrideInput(f), 'cm-replay-same');
  expect(replay).toEqual(first);
  expect(await overrideAndAuditCounts(f)).toEqual([1, 1]);
  expect(await idempotencyClaims(f)).toBe(1);
});

it('the same key with another body is refused and writes nothing new', async () => {
  const first = await runOverride(f, overrideInput(f), 'cm-replay-changed');
  const before = await overrideAndAuditCounts(f);
  await expect(
    runOverride(f, overrideInput(f, { rule: { kind: 'ZERO' } }), 'cm-replay-changed', {
      fingerprint: 'b'.repeat(64),
    }),
  ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
  expect(await overrideAndAuditCounts(f)).toEqual(before);
  expect(first.id).toBeTruthy();
});

it('a busy key is refused with the busy error and writes nothing', async () => {
  const key = 'cm-replay-busy';
  const fingerprint = 'c'.repeat(64);
  const before = await overrideAndAuditCounts(f);
  const holder = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await holder.unsafe('BEGIN');
    // مطالبة مفتاح شغالة: الطلب التاني هيستنى عليها لحد ما مهلة القفل تخلص.
    await holder`INSERT INTO idempotency_keys(
      scope_type,scope_id,company_id,user_id,operation,key,request_fingerprint,expires_at)
      VALUES ('COMPANY',${f.company},${f.company},${f.userId},'create-commission-service-override',
        ${key},${fingerprint},now() + interval '24 hours')`;
    await expect(runOverride(f, overrideInput(f), key, { fingerprint })).rejects.toBeInstanceOf(
      IdempotencyKeyBusyError,
    );
    expect(await overrideAndAuditCounts(f)).toEqual(before);
  } finally {
    await holder.unsafe('ROLLBACK').catch(() => undefined);
    await holder.end();
  }
});

it('two concurrent requests with the same key commit one row and one audit', async () => {
  const before = await overrideAndAuditCounts(f);
  const claims = await idempotencyClaims(f);
  const results = await Promise.allSettled([
    runOverride(f, overrideInput(f), 'cm-replay-concurrent'),
    runOverride(f, overrideInput(f), 'cm-replay-concurrent'),
  ]);
  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  // المنافس ممكن ياخد الرد المخزن أو خطأ busy؛ المهم إن الكتابة واحدة.
  expect(fulfilled.length).toBeGreaterThanOrEqual(1);
  expect(new Set(fulfilled.map((result) => result.value.id)).size).toBe(1);
  for (const result of results) {
    if (result.status === 'rejected') expect(result.reason).toBeInstanceOf(IdempotencyKeyBusyError);
  }
  expect(await overrideAndAuditCounts(f)).toEqual([before[0] + 1, before[1] + 1]);
  expect(await idempotencyClaims(f)).toBe(claims + 1);
});

it('a failed fresh attempt leaves the key free for a later valid retry', async () => {
  const before = await overrideAndAuditCounts(f);
  const claims = await idempotencyClaims(f);
  await expect(
    runOverride(f, overrideInput(f, { effective_from: '2026-10-29' }), 'cm-replay-retry'),
  ).rejects.toMatchObject({ code: 'COMMISSION_EFFECTIVE_FROM_PAST' });
  expect(await overrideAndAuditCounts(f)).toEqual(before);
  expect(await idempotencyClaims(f)).toBe(claims);
  const created = await runOverride(f, overrideInput(f), 'cm-replay-retry');
  expect(created.id).toBeTruthy();
  expect(await overrideAndAuditCounts(f)).toEqual([before[0] + 1, before[1] + 1]);
});

it('a saved response is not replayed once the access is gone', async () => {
  const key = 'cm-replay-access-lost';
  const member = await memberWithoutPlanPermission(f);
  await f.h.owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
    SELECT role_id,role_owner_key,company_id,'manage:commission-plans:business' FROM memberships
    WHERE company_id=${f.company} AND id=${member.membershipId}`;
  const created = await runOverride(f, overrideInput(f), key, { userId: member.userId });
  await f.h.owner`DELETE FROM role_permissions
    WHERE company_id=${f.company} AND permission_code='manage:commission-plans:business'
      AND role_id=(SELECT role_id FROM memberships
        WHERE company_id=${f.company} AND id=${member.membershipId})`;
  const before = await overrideAndAuditCounts(f);
  // نفس المفتاح ونفس الجسم، بس الفاعل فقد الصلاحية: الرد المخزن ما ينفعش يتسلّم.
  await expect(
    runOverride(f, overrideInput(f), key, { userId: member.userId }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await overrideAndAuditCounts(f)).toEqual(before);
  expect(created.id).toBeTruthy();
});
