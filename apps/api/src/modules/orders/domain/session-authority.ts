import { SessionError } from './session-error.ts';

/** حقائق الصلاحيات من identity؛ اختيار العضوية لا يعيد تقييم RBAC أو يحسن حد الشخص. */
export interface SessionAccess { record: boolean; denied: boolean; feature: boolean; membership_ids: readonly string[] }
/**
 * يسمح للمسجلة الأصلية بالإضافة دون grant مع بقاء DENY والسريان والفرع شروطاً إلزامية.
 *
 * @param access حقائق identity الحالية
 * @param selection اختيار اختياري لعضوية المسجلة نفسها
 * @param originalRecorder هوية الأصل في الإضافة فقط
 * @param actor المستخدم الحالي
 * @returns العضوية الوحيدة أو المختارة؛ الغموض ظاهر ولا نختار أعلى حد
 */
export function resolveSessionRecorder(access: SessionAccess, selection: string | undefined, originalRecorder: string | undefined, actor: string): string {
  if (access.denied || (!access.record && originalRecorder !== actor) || access.membership_ids.length === 0)
    throw new SessionError('FORBIDDEN');
  if (!access.feature) throw new SessionError('FEATURE_DISABLED');
  if (selection !== undefined) {
    if (!access.membership_ids.includes(selection)) throw new SessionError('FORBIDDEN');
    return selection;
  }
  if (access.membership_ids.length !== 1) throw new SessionError('SESSION_RECORDER_MEMBERSHIP_REQUIRED', { recorder_membership_ids: [...access.membership_ids] });
  return access.membership_ids[0] as string;
}
