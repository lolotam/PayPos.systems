import {
  buildPushPayload,
  pushTimeToLiveSeconds,
  pushTopic,
  renderPushNotice,
  type PushChannel,
  type PushRequest,
} from '@pospay/notifications';

import {
  pushDecisionFromSubmission,
  pushPreflight,
  refusedDecision,
  type PushDecision,
  type PushDelivery,
  type PushFailureCode,
  type PushTerminalResult,
} from '../../domain/push-delivery.ts';
import type { PushAdmission } from '../../ports/push-admission.port.ts';
import type { Clock } from '../../ports/clock.port.ts';
import type { PushDeliveryRepository } from '../../ports/push-delivery.repository.ts';
import type { IdGenerator } from '../../ports/id-generator.port.ts';

/** نتيجة الإرسال للـ processor: أرقام محدودة بس، من غير أي سر من الاشتراك. */
export interface PushSendOutcome {
  readonly attemptId: string;
  readonly subscriptionId: string;
  readonly status: PushTerminalResult['status'];
  readonly failureCode: PushFailureCode | null;
  readonly httpStatus: number | null;
  readonly vapidRejected: boolean;
}

/** الطلب جاهز للإرسال، أو الرفض المحلي اللي بيمنعه. */
type PushBuild =
  | { readonly kind: 'ready'; readonly request: PushRequest }
  | { readonly kind: 'refused'; readonly decision: PushDecision };

/** ينفّذ محاولة الدفع المرخّصة: فحص محلي، ثم حيازة، ثم طلب واحد، ثم تسجيل النتيجة. */
export class SendPush {
  constructor(
    readonly deliveries: PushDeliveryRepository,
    readonly channel: PushChannel,
    readonly admission: PushAdmission,
    readonly keyId: string,
    readonly clock: Clock,
    readonly ids: IdGenerator,
  ) {}

  async execute(companyId: string, attemptId: string): Promise<PushSendOutcome | null> {
    const delivery = await this.deliveries.pending(companyId, attemptId);
    if (delivery === null) return null;
    const refusal = pushPreflight(delivery, this.keyId, this.clock.now());
    if (refusal !== null) return this.refuse(delivery, refusal);
    const built = this.build(delivery);
    if (built.kind === 'refused') return this.refuse(delivery, built.decision);
    if (!(await this.admission.reserve(delivery.attempt.subscriptionId)))
      return this.refuse(delivery, refusedDecision('ADMISSION_REFUSED'));
    const executionId = this.ids.newId();
    const now = this.clock.now();
    if (!(await this.deliveries.claim(delivery, executionId, now))) return null;
    const claimed: PushDelivery = {
      ...delivery,
      attempt: { ...delivery.attempt, status: 'SENDING', executionId, sendingAt: now },
    };
    const submission = await this.channel.send(built.request);
    const decision = pushDecisionFromSubmission(submission);
    await this.record(claimed, decision);
    return this.outcome(delivery, decision);
  }

  // الطلب بيتبني قبل أي حيازة: نص مش موجود أو حمولة أكبر من الحد معناها رفض محلي بصفر طلبات.
  private build(delivery: PushDelivery): PushBuild {
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
    const payload = buildPushPayload({
      title: copy.title,
      body: copy.body,
      tag: attempt.templateKey,
      lang: attempt.locale,
      token: deliveryToken,
    });
    if (payload === null)
      return { kind: 'refused', decision: refusedDecision('PARAMETERS_INVALID') };
    const ttlSeconds = pushTimeToLiveSeconds(attempt.deadline, this.clock.now());
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

  private async refuse(delivery: PushDelivery, decision: PushDecision): Promise<PushSendOutcome> {
    await this.deliveries.finishPending(delivery, decision, this.ids.newId(), this.clock.now());
    return this.outcome(delivery, decision);
  }

  // النتيجة بتتسجل تلات محاولات بحد أقصى وبنفس معرّف الحدث؛ الفشل في الكتابة ما بيعيدش الطلب.
  private async record(delivery: PushDelivery, decision: PushDecision): Promise<void> {
    const eventId = this.ids.newId();
    const now = this.clock.now();
    try {
      await this.deliveries.finish(delivery, decision, eventId, now);
    } catch {
      try {
        await this.deliveries.finish(delivery, decision, eventId, now);
      } catch {
        await this.deliveries.finish(delivery, decision, eventId, now);
      }
    }
  }

  private outcome(delivery: PushDelivery, decision: PushDecision): PushSendOutcome {
    return {
      attemptId: delivery.attempt.id,
      subscriptionId: delivery.attempt.subscriptionId,
      status: decision.result.status,
      failureCode: decision.result.failureCode,
      httpStatus: decision.result.httpStatus,
      vapidRejected: decision.vapidRejected,
    };
  }
}
