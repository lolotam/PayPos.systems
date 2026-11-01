// التوافق مع الإشعارات: مطالبة التقييم ما بتوصلش لإشعار بحد ذاته لحد ما يتركّب المرسل،
// والطريقتين اللي بتتعاملوا مع غياب المرسل: رفض منطقي بدل إرسال، وإعادة محاولة من غير رمي.
import { afterEach, expect, it } from 'vitest';

import type { Tx } from '@pospay/db';

import {
  fullNotificationModule,
  inAppNotificationModule,
  ratingRegistryWithSender,
  recordingChannel,
} from './rating-claims-notification.fixture.ts';
import {
  advanceNextAttempt,
  attemptsOf,
  authorizedEventIds,
  claimedEventOf,
  notificationDeliverer,
  outboxDispatcher,
  outboxState,
  pendingAttempts,
  readyEventRow,
  receiptRows,
} from './rating-claims-outbox.fixture.ts';
import { at, ratingClaimsWorld } from './rating-claims-world.fixture.ts';
import type { RatingClaimsWorld } from './rating-claims-world.types.ts';

let world: RatingClaimsWorld | undefined;
let dispatcher: ReturnType<typeof outboxDispatcher> | undefined;

afterEach(async () => {
  await dispatcher?.close();
  dispatcher = undefined;
  await world?.close();
  world = undefined;
});

/**
 * يزرع طلباً مستحقاً ويطالب فيه، فحدث الجاهزية يبقى في جدول الـ outbox زي ما بيحصل في الإنتاج.
 *
 * معرّف الحدث ومعرّف الطلب مختلفين: الأول هو سطر الـ outbox، والتاني هو صف الطلب.
 */
async function claimReadyEvent(): Promise<{ readonly eventId: string; readonly requestId: string }> {
  const current = world;
  if (current === undefined) throw new Error('RATING_CLAIM_WORLD_MISSING');
  const seeded = await current.seedDueRequests({ count: 1 });
  await current.turn();
  const event = await readyEventRow(current);
  return { eventId: event.id, requestId: at(seeded.requestIds, 0) };
}

it('default_registry_acknowledges_failed_rating_without_delivery', async () => {
  world = await ratingClaimsWorld({ tokens: true });
  const { eventId } = await claimReadyEvent();
  const channel = recordingChannel();
  const module = fullNotificationModule(world, channel);
  dispatcher = outboxDispatcher(world);
  await dispatcher.dispatchBatch(10, notificationDeliverer(world, module));

  // المحاولة اتسجلت فاشلة: السجل الافتراضي مفيهوش قالب للتقييم، فالإذن اترفض بسبب الإعداد.
  const attempts = await attemptsOf(world, eventId);
  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.status).toBe('FAILED');
  expect(attempts[0]?.failureCode).toBe('CONFIG_INVALID');
  expect(attempts[0]?.templateKey).toBe('rating_request');
  // مفيش محاولة معلّقة أو في الطريق، ومفيش إذن بإرسال.
  expect(await pendingAttempts(world)).toHaveLength(0);
  expect(await authorizedEventIds(world)).toHaveLength(0);
  // الإيصال اتسجل، فالمرسّل أكّد الحدث بدل ما يسيبه معلّق.
  expect(await receiptRows(world, eventId)).toHaveLength(1);
  const state = await outboxState(world, eventId);
  expect(state.publishedAt).not.toBeNull();
  expect(state.parkedAt).toBeNull();
  expect(state.attempts).toBe(1);
  // ومفيش أي إرسال خارجي.
  expect(channel.calls).toHaveLength(0);
}, 120_000);

it('inapp_only_retries_rating_without_delivery', async () => {
  world = await ratingClaimsWorld({ tokens: true });
  const { eventId } = await claimReadyEvent();
  const module = inAppNotificationModule(world);
  const event = await claimedEventOf(world, eventId);

  // الإذن نفسه بيرفض: موديل داخل التطبيق مش جاهز للإرسال.
  const handle = (tx: Tx) => module.consumer.handle(tx, event);
  const code = 'NOTIFICATIONS_LIVE_REQUIRES_PR6';
  await expect(world.base.db.withTenant(world.company, handle)).rejects.toThrow(code);
  // المحاولة والإيصال اتلفوا مع المعاملة، فما فيش سطر ملتزم منهم.
  expect(await attemptsOf(world, eventId)).toHaveLength(0);
  expect(await receiptRows(world, eventId)).toHaveLength(0);

  dispatcher = outboxDispatcher(world);
  const deliver = notificationDeliverer(world, module);
  await dispatcher.dispatchBatch(10, deliver);
  // المرسّل شاف الفشل: الحدث مانتشرش، وطلع له موعد محاولة تانية، ومالوش ركن لسه.
  const failed = await outboxState(world, eventId);
  expect(failed.publishedAt).toBeNull();
  expect(failed.parkedAt).toBeNull();
  expect(failed.attempts).toBe(1);
  expect(failed.lastError).not.toBeNull();
  expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  expect(await attemptsOf(world, eventId)).toHaveLength(0);

  // المرسّل بيحاول تاني لحد ما يركن الحدث بعد عشر محاولات.
  for (let round = 1; round <= 10; round += 1) {
    await advanceNextAttempt(world, eventId);
    await dispatcher.dispatchBatch(10, deliver);
    if ((await outboxState(world, eventId)).parkedAt !== null) break;
  }
  const parked = await outboxState(world, eventId);
  expect(parked.parkedAt).not.toBeNull();
  expect(parked.publishedAt).toBeNull();
  expect(parked.attempts).toBe(10);
  expect(await attemptsOf(world, eventId)).toHaveLength(0);
}, 180_000);

it('installing_sender_does_not_replay_consumed_claim', async () => {
  world = await ratingClaimsWorld({ tokens: true });
  const { eventId, requestId } = await claimReadyEvent();
  const firstChannel = recordingChannel();
  const firstModule = fullNotificationModule(world, firstChannel);
  dispatcher = outboxDispatcher(world);
  await dispatcher.dispatchBatch(10, notificationDeliverer(world, firstModule));
  expect(await attemptsOf(world, eventId)).toHaveLength(1);

  // المرسل اتركّب: السجل بقى فيه قالب التقييم.
  const installedChannel = recordingChannel();
  const installed = fullNotificationModule(world, installedChannel, ratingRegistryWithSender());
  const event = await claimedEventOf(world, eventId);
  // إعادة التسليم زي ما المرسّل بيعملها: نفس الهوية، فالإيصال بيمنع التكرار.
  const outcome = await notificationDeliverer(world, installed)(event);
  expect(outcome.delivered).toBe(true);
  // وحتى لو المستهلك اشتغل، محاولة الإذن نفسها بتتعارض مع المحاولة القديمة.
  await world.base.db.withTenant(world.company, (tx) => installed.consumer.handle(tx, event));

  // مفيش محاولة جديدة، ولا إذن بإرسال، ولا إرسال خارجي.
  const attempts = await attemptsOf(world, eventId);
  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.status).toBe('FAILED');
  expect(await authorizedEventIds(world)).toHaveLength(0);
  expect(installedChannel.calls).toHaveLength(0);
  expect(firstChannel.calls).toHaveLength(0);
  // الطلب فضل SENDING، وما اتعملهوش رجوع ولا إعادة.
  const statuses = await world.requestStatuses();
  expect(statuses.get(requestId)).toBe('SENDING');
  const state = await outboxState(world, eventId);
  expect(state.attempts).toBe(1);
}, 120_000);
