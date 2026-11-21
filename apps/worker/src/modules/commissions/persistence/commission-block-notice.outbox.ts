import { appendOutboxEvent, type Tx } from '@pospay/db';

import { groupCommissionBlockNoticeRecipients } from '../domain/commission-block-notice.ts';
import type {
  CommissionBlockNoticeInput,
  CommissionBlockNotices,
  CommissionPermissionHoldersReader,
} from '../ports/commission-block-notice.port.ts';
import type { Clock, IdGenerator } from '../ports/commission-line-projection.port.ts';

/** صلاحية إدارة خطط العمولة: أصحابها هما اللي بيصلّحوا التصحيح الموقوف (CS-Q19). */
const MANAGE_COMMISSION_PLANS = 'manage:commission-plans:business';

/**
 * يبني منفذ الجرس على معاملة التوقف نفسها: المستلمون من الهوية بلا قفل، والحدث
 * بيتكتب في نفس المعاملة، فإخفاق أي مجموعة بيلغي التوقف كمان (FR-049).
 *
 * @param tx معاملة withTenant الحالية
 * @param ids مولّد هوية الحدث المحقون
 * @param clock ساعة اللحظة الحالية المحقونة
 * @param boundary قارئ حاملي الصلاحية وحد المجموعة ومدقق الحمولة من جذر التوصيل
 * @returns منفذ الجرس مربوط بالمعاملة
 */
export function createCommissionBlockNotices(
  tx: Tx,
  ids: IdGenerator,
  clock: Clock,
  boundary: {
    readonly permissionHolders: CommissionPermissionHoldersReader<Tx>;
    readonly groupSize: number;
    readonly parsePayload: (payload: unknown) => unknown;
  },
): CommissionBlockNotices {
  return {
    now: () => clock.now(),
    recipientGroups: async (companyId, businessId, at) => {
      const recipients = await boundary.permissionHolders(
        tx,
        companyId,
        businessId,
        MANAGE_COMMISSION_PLANS,
        at,
      );
      return groupCommissionBlockNoticeRecipients(recipients, boundary.groupSize);
    },
    append: async (input: CommissionBlockNoticeInput) => {
      await appendOutboxEvent(tx, ids.newId(), {
        aggregateType: 'commission_blocked_correction',
        aggregateId: input.blockId,
        eventType: 'CommissionCorrectionBlockedNoticeRequested',
        payload: boundary.parsePayload({
          schema_version: 1,
          block_id: input.blockId,
          group_index: input.groupIndex,
          business_id: input.businessId,
          source_period: input.sourcePeriod,
          notification_recipients: input.recipients.map((user_id) => ({
            channel: 'IN_APP',
            user_id,
            locale: 'ar',
            template_key: 'commission_correction_blocked',
            template_revision: 1,
            safe_parameters: [{ name: 'period', type: 'text', value: input.sourcePeriod }],
          })),
        }),
      });
    },
  };
}
