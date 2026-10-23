import { isAllowedPushEndpoint } from '@pospay/contracts';
import {
  buildPushPayload,
  isValidSubscriptionKeys,
  pushTimeToLiveSeconds,
  pushTopic,
  renderPushNotice,
} from '@pospay/notifications';

import {
  invalidEndpointDecision,
  refusedDecision,
  type PushDelivery,
} from '../domain/push-delivery.ts';
import type { PushBuild, PushRequestBuilder } from '../ports/push-request-builder.port.ts';

/**
 * باني طلب الدفع: يجمع النص والحمولة ومدة البقاء والموضوع من المحاولة واشتراكها.
 * القاعدة: الوجهة بتتأكد إنها على قائمة المواقع المسموحة (ADR-0052 §3) والمفاتيح بتتأكد شكلها
 * قبل أي سر يستعمل؛ ونص مش موجود أو حمولة أكبر من الحد معناها رفض محلي بصفر طلبات.
 *
 * @param delivery المحاولة واشتراكها
 * @param now      اللحظة الحالية
 * @returns الطلب جاهز، أو الرفض المحلي
 */
function build(delivery: PushDelivery, now: Date): PushBuild {
  const attempt = delivery.attempt;
  const copy = renderPushNotice(
    attempt.templateKey,
    attempt.templateRevision,
    attempt.locale,
    attempt.safeParameters,
  );
  if (copy === null) return { kind: 'refused', decision: refusedDecision('PARAMETERS_INVALID') };
  const { endpoint, p256dh, auth, deliveryToken } = delivery.subscription;
  // الفحص المحلي في الـ domain رجّع null، فالأسرار موجودة؛ الشرط ده للتضييق بس.
  if (endpoint === null || p256dh === null || auth === null || deliveryToken === null)
    return { kind: 'refused', decision: refusedDecision('PARAMETERS_INVALID') };
  // وجهة مش مسموحة معناها إن الاشتراك ما بيوصلش لخدمة دفع؛ بيتسحب بدل ما نبعت لعنوان غريب.
  if (!isAllowedPushEndpoint(endpoint))
    return { kind: 'refused', decision: invalidEndpointDecision() };
  // مفاتيح مش سليمة معناها إن التشفير هيفشل؛ الاشتراك بيتسحب برضه لأنه ما بيشتغلش.
  if (!isValidSubscriptionKeys(p256dh, auth))
    return { kind: 'refused', decision: invalidEndpointDecision() };
  const payload = buildPushPayload({
    title: copy.title,
    body: copy.body,
    tag: attempt.templateKey,
    lang: attempt.locale,
    token: deliveryToken,
  });
  if (payload === null) return { kind: 'refused', decision: refusedDecision('PARAMETERS_INVALID') };
  const ttlSeconds = pushTimeToLiveSeconds(attempt.deadline, now);
  if (ttlSeconds === null)
    return { kind: 'refused', decision: refusedDecision('DEADLINE_EXPIRED') };
  return {
    kind: 'ready',
    request: {
      target: { endpoint, p256dh, auth },
      payload,
      ttlSeconds,
      urgency: 'high',
      topic: pushTopic(attempt.sourceEventId),
      deadline: attempt.deadline,
    },
  };
}

/**
 * @returns باني طلب الدفع، والنصوص والحمولة من packages/notifications
 */
export function createPushRequestBuilder(): PushRequestBuilder {
  return { build };
}
