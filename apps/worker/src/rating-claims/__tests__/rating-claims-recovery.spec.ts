// التعافي والمواعيد النهائية: الجدولة الضايعة بتتعافى من غير زيارة جديدة، والموعد
// النهائي الفاضي أو اللي عدّى بيفضل بقواعد 2a.
import { afterEach, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import {
  closeRedisClient,
  RATING_CLAIMS_QUEUE,
  startRatingClaimsProcessor,
} from '../../modules/customers/jobs/rating-claims.processor.ts';
import {
  firstCompanyTarget,
  instantOf,
  openSecondCompany,
  readyRequestIdsByCompany,
  removeScheduler,
  schedulerOf,
  secondCompanyTarget,
  seedOneRequest,
  stateKeyOf,
  waitForReadyEvents,
} from './rating-claims-recovery.fixture.ts';
import {
  at,
  CLOCK_AT,
  ratingClaimsWorld,
  redisUrl,
  SEND_DEADLINE,
} from './rating-claims-world.fixture.ts';
import type { RatingClaimsWorld } from './rating-claims-world.types.ts';

let world: RatingClaimsWorld | undefined;

/** موعد نهائي عدّى: قبل ساعة الاختبار بنص ساعة. */
const PAST = new Date('2026-06-01T13:00:00.000Z');

afterEach(async () => {
  await world?.close();
  world = undefined;
});

it('lost_scheduler_recovers_without_new_visit', async () => {
  world = await ratingClaimsWorld({ tokens: true });
  await openSecondCompany(world);
  const prefix = `${world.prefix}:bull`;
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  connection.on('error', () => undefined);
  const queue = new Queue(RATING_CLAIMS_QUEUE, { connection, prefix });
  queue.on('error', () => undefined);
  const processor = startRatingClaimsProcessor({ redisUrl, prefix, turn: world.worker() });
  await processor.ready();
  try {
    const companies = [world.company, world.otherCompany];
    // الجدولة اتسجلت، ودور يدوي عمل الحالة، فالضياع يبان في الاتنين.
    for (const companyId of companies) await processor.ensureRegistered(companyId);
    expect(await schedulerOf(queue, world.company)).toBeDefined();
    for (const companyId of companies) await world.worker().execute(companyId);
    const before = await world.state.port.read(world.company);
    expect(before.code).toBe('OK');
    expect(before.value?.incarnation).toBeDefined();
    // ضياع الجدولة والحالة: مفيش زيارة جديدة، بس Redis اتمسح.
    for (const companyId of companies) {
      await removeScheduler(queue, companyId);
      await world.redis.del(stateKeyOf(world.prefix, companyId));
    }
    expect(await schedulerOf(queue, world.company)).toBeUndefined();
    // التسجيل من جديد بمخزون الشركات كامل ومصرّح بيه.
    for (const companyId of companies) await processor.ensureRegistered(companyId);
    expect(await schedulerOf(queue, world.company)).toBeDefined();
    expect(await schedulerOf(queue, world.otherCompany)).toBeDefined();
    // الطلبات المستحقة موجودة من الأول ولسه ما اتطالبتش.
    const first = await seedOneRequest(world, firstCompanyTarget(world), 70);
    const second = await seedOneRequest(world, secondCompanyTarget(), 80);
    // الجدولة الحقيقية بتشتغل، فالمطالبات بتتعافى من غير زيارة جديدة.
    const ready = await waitForReadyEvents(world, companies);
    expect(ready.get(world.company)).toEqual([at(first.requestIds, 0)]);
    expect(ready.get(world.otherCompany)).toEqual([at(second.requestIds, 0)]);
    // الحالة جديدة: نسخة مختلفة عن اللي ضاعت.
    const after = await world.state.port.read(world.company);
    expect(after.value?.incarnation).not.toBe(before.value?.incarnation);
  } finally {
    await processor.close();
    await queue.close();
    await closeRedisClient(connection);
  }
}, 300_000);

it('null_and_expired_deadlines_keep_2a_semantics', async () => {
  world = await ratingClaimsWorld({ tokens: true });
  const base = world.base;
  // (أ) موعد نهائي مخزن null: مفيش انتهاء، والمطالبة بتكمّل لحد ما تتطلب.
  const nullStored = await seedOneRequest(world, firstCompanyTarget(world), 90, null);
  expect(await base.claimOne(at(nullStored.requestIds, 0))).toBe('CLAIMED');
  // (أ) موعد نهائي معاد حسابه null: فرع من غير مواعيد، فمفيش إغلاق معروف أصلاً.
  const noHours = await base.branch({ timezone: 'Asia/Kuwait', openingHours: null });
  const nullRecomputed = await seedOneRequest(world, firstCompanyTarget(world, noHours), 91, null);
  expect(await base.claimOne(at(nullRecomputed.requestIds, 0))).toBe('CLAIMED');

  // (ب) موعد نهائي عدّى: الطلب اتلغى بسبب الموعد النهائي، وماتبعثش.
  const expired = await seedOneRequest(world, firstCompanyTarget(world), 92, PAST);
  expect(await base.claimOne(at(expired.requestIds, 0))).toBe('PAST_DEADLINE');
  const expiredRow = await base.request(at(expired.customerIds, 0));
  expect(expiredRow?.status).toBe('CANCELLED');
  expect(expiredRow?.cancel_reason).toBe('PAST_DEADLINE');

  // (ج) التساوي: الموعد النهائي بالظبط زي الساعة مش منتهٍ، لأن القاعدة «قبل» مش «قبل أو يساوي».
  base.clock.at = new Date(SEND_DEADLINE.getTime());
  const equal = await seedOneRequest(world, firstCompanyTarget(world), 93, SEND_DEADLINE);
  expect(await base.claimOne(at(equal.requestIds, 0))).toBe('CLAIMED');
  base.clock.at = CLOCK_AT;

  // (د) الموعد النهائي عدّى والعميل ماسك: الساعة بعد القفل هي اللي بتقرر.
  const crossed = await seedOneRequest(world, firstCompanyTarget(world), 94, SEND_DEADLINE);
  const held = base.claimHoldingCustomerLock(at(crossed.requestIds, 0));
  await held.locked;
  base.clock.at = new Date(SEND_DEADLINE.getTime() + 60_000);
  held.release();
  expect(await held.done).toBe('PAST_DEADLINE');
  const crossedRow = await base.request(at(crossed.customerIds, 0));
  expect(crossedRow?.status).toBe('CANCELLED');
  expect(crossedRow?.cancel_reason).toBe('PAST_DEADLINE');
  // مفيش تمديد للموعد النهائي، ومفيش إعادة إرسال للطلب.
  expect(instantOf(crossedRow?.send_deadline).getTime()).toBe(SEND_DEADLINE.getTime());
  const ready = await readyRequestIdsByCompany(world, [world.company]);
  expect(ready.get(world.company) ?? []).not.toContain(at(crossed.requestIds, 0));
  expect(ready.get(world.company) ?? []).not.toContain(at(expired.requestIds, 0));
}, 180_000);
