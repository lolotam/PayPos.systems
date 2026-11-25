import { readAccessProof } from '@/shared/api/read-access-proof';

import type { VisibilityReads } from './use-visibility-reads';

// قراءة أوقفها انقطاع الاتصال قبل أن تجيب لن تصل ما دام الانقطاع قائمًا، فتُعدّ مقفولة ولا تُبقِ العنوان في «جارٍ التحميل».
function waiting(read: { isPending: boolean; fetchStatus: string }): boolean {
  return read.isPending && read.fetchStatus !== 'paused';
}

/**
 * هل ما تزال قراءة تنتظر جوابها الأول وقد يغيّر جوابها ما تراه القوائم؟ قراءة نجحت وكفت لا تُنتظر
 * (التنبيهات أو التقييم: يكفي نجاح واحدة)، ورفض 403 جواب نهائي لا انتظار بعده.
 * وقراءة أوقفها انقطاع الاتصال قبل أن تجيب مقفولة لا معلّقة: `/overview` و`/soon` ما بيستناشوا جوابها.
 *
 * @param reads حالة القراءات خلف شروط الظهور
 * @returns true إن بقيت قراءة واحدة على الأقل لم يصل جوابها
 */
export function visibilityReadsPending(reads: VisibilityReads): boolean {
  if (!reads.open) return false;
  const alertsKnown = reads.alerts.isSuccess || reads.rating.isSuccess;
  return (
    (!alertsKnown && (waiting(reads.alerts) || waiting(reads.rating))) ||
    waiting(reads.identity) ||
    (!reads.planAccess.denied && waiting(reads.planEmployees)) ||
    waiting(reads.appLink) ||
    readAccessProof(reads.refunds) === 'pending' ||
    readAccessProof(reads.ratings) === 'pending' ||
    waiting(reads.leave) ||
    waiting(reads.columns)
  );
}
