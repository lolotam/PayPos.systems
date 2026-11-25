import { PARKED_ALERT_CONSUMER_ID, type ParkedAlertOutcome } from '@pospay/domain';

import { countsAsPendingCommissionEvent } from '../../domain/parked-commission-event.ts';
import { groupParkedAlertRecipients } from '../../domain/parked-alert-recipients.ts';
import type {
  ParkedAlertNotifier,
  ParkedAlertOwnersReader,
  ParkedAlertProjectionReader,
  ParkedAlertTenantRunner,
} from '../../ports/parked-commission-alert.port.ts';

export { PARKED_ALERT_CONSUMER_ID };
export type { ParkedAlertOutcome };

/** الحدث الموقوف: هويته ونوعه وشركته فقط، بلا حمولة (ADR-0012 §3). */
export interface ParkedCommissionEvent {
  readonly companyId: string;
  readonly eventId: string;
  readonly eventType: string;
}

/** ما تحتاجه حالة الاستخدام: معاملة الشركة، مالكيها، علامة التكرار، وكتابة الجرس. */
export interface ParkedCommissionAlertDeps<Transaction> {
  readonly withTenant: ParkedAlertTenantRunner<Transaction>;
  readonly owners: ParkedAlertOwnersReader<Transaction>;
  readonly isInputProjected: ParkedAlertProjectionReader<Transaction>;
  readonly markConsumed: (
    tx: Transaction,
    consumerId: string,
    eventId: string,
  ) => Promise<boolean>;
  readonly appendNotice: ParkedAlertNotifier<Transaction>;
  readonly now: () => Date;
  readonly groupSize: number;
}

/**
 * يرفع تنبيه المالك على حدث عمولة وقف: علامة التكرار والجرس في معاملة واحدة
 * بعد ثبوت الوقف، والمستلمون هم مالكي الشركة (ADR-0012 §3، A4).
 */
export class RaiseParkedCommissionAlert<Transaction> {
  constructor(private readonly deps: ParkedCommissionAlertDeps<Transaction>) {}

  async execute(event: ParkedCommissionEvent): Promise<ParkedAlertOutcome> {
    if (!countsAsPendingCommissionEvent(event.eventType)) return 'NOT_A_COMMISSION_EVENT';
    return this.deps.withTenant(event.companyId, async (tx) => {
      // الحدث اللي إسقاطه مستهلك العمولة فعلاً ما بيمنعش الاعتماد، فالتنبيه مالهوش لازمة
      // (ADR-0012 §3.1). بس علامته بتتسجل عشان المسح بعد كده ما يعيدش تسأل عليه.
      if (await this.deps.isInputProjected(tx, event.eventId)) {
        const marked = await this.deps.markConsumed(tx, PARKED_ALERT_CONSUMER_ID, event.eventId);
        return marked ? 'NOT_BLOCKING' : 'ALREADY_ALERTED';
      }
      const owners = await this.deps.owners(tx, event.companyId, this.deps.now());
      if (owners.length === 0) return 'NO_OWNERS';
      const marked = await this.deps.markConsumed(tx, PARKED_ALERT_CONSUMER_ID, event.eventId);
      if (!marked) return 'ALREADY_ALERTED';
      const groups = groupParkedAlertRecipients(owners, this.deps.groupSize);
      for (const [groupIndex, recipients] of groups.entries()) {
        // The outbox event-type scan reads `eventType:` property assignments and only understands
        // literals; the stopped event's type is dynamic by design, so the object is built by shorthand.
        const { eventId, eventType } = event;
        await this.deps.appendNotice(tx, { eventId, eventType, groupIndex, recipients });
      }
      return 'ALERTED';
    });
  }
}
