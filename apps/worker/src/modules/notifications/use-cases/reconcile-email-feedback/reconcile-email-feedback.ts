import {
  emailFeedbackDecision,
  emailFeedbackRoute,
  nextFeedbackRetry,
  type EmailRetrievalResult,
} from '../../domain/email-feedback.ts';
import type { Clock } from '../../ports/clock.port.ts';
import type {
  EmailFeedbackAuthRepository,
  EmailFeedbackInboxRepository,
  EmailFeedbackRow,
  EmailFeedbackTenantRepository,
  EmailRetrievalPort,
} from '../../ports/email-feedback.port.ts';
import type { IdGenerator } from '../../ports/id-generator.port.ts';

/**
 * يظبط ردّ المزود على محاولة: استرجاع من المزود، ثم سجل الاعتماد أو سجل الشركة،
 * ثم الحظر والتسوية. المرحلتين في معاملتين منفصلتين: معاملة السجل الأول، ومعاملة
 * المنصة بعد ما الأولى تتثبّت.
 */
export class ReconcileEmailFeedback {
  constructor(
    private readonly inbox: EmailFeedbackInboxRepository,
    private readonly tenant: EmailFeedbackTenantRepository,
    private readonly auth: EmailFeedbackAuthRepository,
    private readonly retrieval: EmailRetrievalPort,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    /** بصمة معرّف رسالة المزود — المعرّف الخام ما بيسجلش في أي سجل. */
    private readonly digest: (providerMessageId: string) => Uint8Array,
  ) {}

  async execute(inboxId: string): Promise<void> {
    const row = await this.inbox.pending(inboxId);
    if (row === null) return;
    try {
      // الاسترجاع بره أي معاملة: مزود خارجي مينفعش يكون جوه transaction.
      const retrieved = await this.retrieval.retrieve(row.providerEmailId);
      const now = this.clock.now();
      if (retrieved.kind === 'invalid_tags') {
        await this.inbox.quarantine(row.id, 'TAGS_INVALID', now);
        return;
      }
      if (retrieved.kind === 'transient') {
        await this.retry(row, now);
        return;
      }
      // بريد الاعتماد بيتسوّى على سجل الاعتماد، وبريد الشركة على سجل الشركة — والوسم بيحدد الطريق.
      const route = emailFeedbackRoute(retrieved.tags);
      if (route.kind === 'invalid') {
        await this.inbox.quarantine(row.id, 'TAGS_INVALID', now);
        return;
      }
      const outcome =
        route.kind === 'tenant'
          ? await this.tenant.reconcile({
              companyId: route.companyId,
              attemptId: retrieved.tags.attemptId,
              executionId: retrieved.tags.executionId,
              providerEmailId: retrieved.id,
              recipientHash: retrieved.recipientHash,
              hashKeyId: retrieved.hashKeyId,
              feedbackId: this.ids.newId(),
              feedbackType: row.feedbackType,
              bounceClass: row.bounceClass,
              providerEventDigest: row.providerEventDigest,
              providerTimestamp: row.providerTimestamp,
              recordedAt: now,
            })
          : await this.auth.reconcile({
              challengeId: route.challengeId,
              attemptId: retrieved.tags.attemptId,
              executionId: retrieved.tags.executionId,
              recipientHash: retrieved.recipientHash,
              hashKeyId: retrieved.hashKeyId,
              providerMessageDigest: this.digest(retrieved.id),
            });
      if (!outcome.ok) {
        await this.inbox.quarantine(row.id, outcome.reason, now);
        return;
      }
      await this.settle(row, retrieved, now);
    } catch (error) {
      await this.retry(row, this.clock.now());
      throw error;
    }
  }

  private async retry(row: EmailFeedbackRow, now: Date): Promise<void> {
    const attempts = row.attempts + 1;
    const next = nextFeedbackRetry(attempts, now);
    if (next.quarantine !== null) {
      await this.inbox.quarantine(row.id, next.quarantine, now);
      return;
    }
    await this.inbox.scheduleRetry(row.id, attempts, next.nextAttemptAt);
  }

  private async settle(
    row: EmailFeedbackRow,
    retrieved: Extract<EmailRetrievalResult, { kind: 'found' }>,
    now: Date,
  ): Promise<void> {
    const decision = emailFeedbackDecision(row.feedbackType, row.bounceClass);
    await this.inbox.settle({
      inboxId: row.id,
      at: now,
      auditId: this.ids.newId(),
      suppression: decision.suppress
        ? {
            recipientHash: retrieved.recipientHash,
            hashKeyId: retrieved.hashKeyId,
            source: decision.source,
            reason: decision.reason,
          }
        : null,
    });
  }
}
