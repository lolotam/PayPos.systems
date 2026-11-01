import { checkStaffPrivateView, closeStaffPrivateView } from '@pospay/db';
import type { PrivateViewScope } from './proof.ts';
import {
  PRIVATE_VIEW_CAP_MS,
  PRIVATE_VIEW_IDLE_MS,
  type PrivateViewStoreOptions,
} from './options.ts';

export interface PrivateViewPassed {
  readonly kind: 'passed';
  readonly idleRemainingMs: number;
  readonly capRemainingMs: number;
}

export interface PrivateViewExpired {
  readonly kind: 'expired';
}

export interface PrivateViewMismatch {
  readonly kind: 'mismatch';
}

export type PrivateViewCheckResult =
  | PrivateViewPassed
  | PrivateViewExpired
  | PrivateViewMismatch;

/**
 * يتحقق ويلمس في عبارة واحدة؛ شرط window_id يمنع طلب قديم من تمديد نافذة أحدث.
 *
 * @param options اتصال الاعتماد وساعته
 * @param scope الجلسة والمشغل والجهاز المرتبطون بالنافذة
 * @param windowId المعرّف العشوائي الذي حمله الطلب
 * @returns المرور والمدد المتبقية، أو الانتهاء، أو اختلافاً لا يغير التخزين
 */
export async function checkPrivateView(
  options: PrivateViewStoreOptions,
  scope: PrivateViewScope,
  windowId: string,
): Promise<PrivateViewCheckResult> {
  const now = options.now();
  const outcome = await checkStaffPrivateView(options.database, {
    sessionId: scope.sessionId,
    userId: scope.userId,
    deviceId: scope.deviceId,
    windowId,
    now,
    idleFloor: new Date(now.getTime() - PRIVATE_VIEW_IDLE_MS),
    capFloor: new Date(now.getTime() - PRIVATE_VIEW_CAP_MS),
  });
  if (outcome.kind === 'expired') return { kind: 'expired' };
  if (outcome.kind === 'mismatch') return { kind: 'mismatch' };
  const capRemainingMs = PRIVATE_VIEW_CAP_MS - (now.getTime() - outcome.createdAt.getTime());
  return {
    kind: 'passed',
    idleRemainingMs: Math.min(PRIVATE_VIEW_IDLE_MS, capRemainingMs),
    capRemainingMs,
  };
}

/**
 * يقفل فقط النافذة المسماة؛ بقاء عداد الجلسة يحفظ ترتيب window_seq للفتح التالي.
 *
 * @param options اتصال الاعتماد
 * @param scope نطاق الجلسة صاحبة النافذة
 * @param windowId معرّف النافذة المطلوب قفلها
 * @returns true عند حذف صفها، وfalse لطلب متأخر أو معرّف مختلف
 */
export async function closePrivateView(
  options: PrivateViewStoreOptions,
  scope: PrivateViewScope,
  windowId: string,
): Promise<boolean> {
  return closeStaffPrivateView(options.database, {
    sessionId: scope.sessionId,
    windowId,
  });
}
