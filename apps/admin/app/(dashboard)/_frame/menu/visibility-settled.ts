import { readAccessProof } from '@/shared/api/read-access-proof';

import type { VisibilityReads } from './use-visibility-reads';

/**
 * هل ما تزال قراءة تنتظر جوابها الأول وقد يغيّر جوابها ما تراه القوائم؟ قراءة نجحت وكفت لا تُنتظر
 * (التنبيهات أو التقييم: يكفي نجاح واحدة)، ورفض 403 جواب نهائي لا انتظار بعده.
 *
 * @param reads حالة القراءات خلف شروط الظهور
 * @returns true إن بقيت قراءة واحدة على الأقل لم يصل جوابها
 */
export function visibilityReadsPending(reads: VisibilityReads): boolean {
  if (!reads.open) return false;
  const alertsKnown = reads.alerts.isSuccess || reads.rating.isSuccess;
  return (
    (!alertsKnown && (reads.alerts.isPending || reads.rating.isPending)) ||
    reads.identity.isPending ||
    (!reads.planAccess.denied && reads.planEmployees.isPending) ||
    reads.appLink.isPending ||
    readAccessProof(reads.refunds) === 'pending' ||
    reads.leave.isPending ||
    reads.columns.isPending
  );
}
