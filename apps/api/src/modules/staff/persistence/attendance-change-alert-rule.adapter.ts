import type { Tx } from '@pospay/db';
import type { AlertKind } from '@pospay/domain';

import { readAlertRule } from '../../settings/index.ts';

// القاعدة بتتقري على معاملة المُرسِل نفسها، عشان قرار الإشعار يتبني على نفس البيانات اللي باقي الكتابة شايفها.
export const attendanceChangeAlertRule = (
  tx: Tx,
  companyId: string,
  scope: { businessId: string; branchId: string | null },
  kind: AlertKind,
) => readAlertRule(tx, companyId, scope, kind);
