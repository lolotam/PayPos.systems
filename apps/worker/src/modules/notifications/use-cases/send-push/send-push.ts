import type { PushChannel } from '@pospay/notifications';

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
import type { PushRequestBuilder } from '../../ports/push-request-builder.port.ts';

/** نتيجة الإرسال للـ processor: أرقام محدودة بس، من غير أي سر من الاشتراك. */
export interface PushSendOutcome {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string | null;
  readonly branchId: string | null;
  readonly attemptId: string;
  readonly subscriptionId: string;
  readonly status: PushTerminalResult['status'];
  readonly failureCode: PushFailureCode | null;
  readonly httpStatus: number | null;
  readonly vapidRejected: boolean;
}

/** ينفّذ محاولة الدفع المرخّصة: فحص محلي، ثم حيازة، ثم طلب واحد، ثم تسجيل النتيجة. */
export class SendPush {
  constructor(
    readonly deliveries: PushDeliveryRepository,
    readonly builder: PushRequestBuilder,
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
    const built = this.builder.build(delivery, this.clock.now());
    if (built.kind === 'refused') return this.refuse(delivery, built.decision);
    const executionId = this.ids.newId();
    const now = this.clock.now();
    if (!(await this.deliveries.claim(delivery, executionId, now)))
      return this.lostClaim(companyId, attemptId);
    const claimed: PushDelivery = {
      ...delivery,
      attempt: { ...delivery.attempt, status: 'SENDING', executionId, sendingAt: now },
    };
    // الحجز بعد الحيازة: كذا التنفيذين المتوازيين لنفس المحاولة ما ياخدوش سعة واحدة.
    const refused = await this.reserve(delivery);
    if (refused !== null) {
      await this.record(claimed, refused);
      return this.outcome(delivery, refused);
    }
    const submission = await this.channel.send(built.request);
    const decision = pushDecisionFromSubmission(submission);
    await this.record(claimed, decision);
    return this.outcome(delivery, decision);
  }

  // الحجز بيرجع رفضًا محليًا لما السعة تخلص أو لما Redis يفشل؛ نص الخطأ ما بيتحفظش.
  private async reserve(delivery: PushDelivery): Promise<PushDecision | null> {
    try {
      const allowed = await this.admission.reserve(delivery.attempt.subscriptionId);
      return allowed ? null : refusedDecision('ADMISSION_REFUSED');
    } catch {
      return refusedDecision('ADMISSION_REFUSED');
    }
  }

  // حيازة ضايعة: المحاولة بتتفتح تاني، فلو السبب محلي بيتسجل فورًا بدل ما تفضل معلّقة.
  private async lostClaim(companyId: string, attemptId: string): Promise<PushSendOutcome | null> {
    const current = await this.deliveries.pending(companyId, attemptId);
    if (current === null) return null;
    const refusal = pushPreflight(current, this.keyId, this.clock.now());
    if (refusal === null) return null;
    return this.refuse(current, refusal);
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
      companyId: delivery.attempt.companyId,
      userId: delivery.attempt.userId,
      businessId: delivery.attempt.businessId,
      branchId: delivery.attempt.branchId,
      attemptId: delivery.attempt.id,
      subscriptionId: delivery.attempt.subscriptionId,
      status: decision.result.status,
      failureCode: decision.result.failureCode,
      httpStatus: decision.result.httpStatus,
      vapidRejected: decision.vapidRejected,
    };
  }
}
