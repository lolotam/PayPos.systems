import { countsAsPendingCommissionEvent } from '../../domain/parked-commission-event.ts';
import { groupParkedAlertRecipients } from '../../domain/parked-alert-recipients.ts';
import type {
  ParkedAlertNotifier,
  ParkedAlertOwnersReader,
  ParkedAlertTenantRunner,
} from '../../ports/parked-commission-alert.port.ts';

/** هوية المستهلك اللي بيمثّل التنبيه نفسه؛ علامته هي اللي بتمنع تكرار التنبيه. */
export const PARKED_ALERT_CONSUMER_ID = 'commissions.park-alert';

/** الحدث الموقوف: هويته ونوعه وشركته فقط، بلا حمولة (ADR-0012 §3). */
export interface ParkedCommissionEvent {
  readonly companyId: string;
  readonly eventId: string;
  readonly eventType: string;
}

/** نتيجة التنبيه: ليه رُفع أو ليه ما رُفعش. */
export type ParkedAlertOutcome =
  | 'ALERTED'
  | 'NOT_A_COMMISSION_EVENT'
  | 'ALREADY_ALERTED'
  | 'NO_OWNERS';

/** ما تحتاجه حالة الاستخدام: معاملة الشركة، مالكيها، علامة التكرار، وكتابة الجرس. */
export interface ParkedCommissionAlertDeps<Transaction> {
  readonly withTenant: ParkedAlertTenantRunner<Transaction>;
  readonly owners: ParkedAlertOwnersReader<Transaction>;
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
      const owners = await this.deps.owners(tx, event.companyId, this.deps.now());
      if (owners.length === 0) return 'NO_OWNERS';
      const marked = await this.deps.markConsumed(tx, PARKED_ALERT_CONSUMER_ID, event.eventId);
      if (!marked) return 'ALREADY_ALERTED';
      const groups = groupParkedAlertRecipients(owners, this.deps.groupSize);
      for (const [groupIndex, recipients] of groups.entries()) {
        await this.deps.appendNotice(tx, {
          eventId: event.eventId,
          eventType: event.eventType,
          groupIndex,
          recipients,
        });
      }
      return 'ALERTED';
    });
  }
}
