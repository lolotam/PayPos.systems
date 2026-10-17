import { SessionError } from './session-error.ts';

/** عضويات التعديل المؤهلة بذاتها؛ الاختيار لا يعيد تقييم الصلاحية ولا يرفع الحد. */
export interface SessionEditAccess {
  denied: boolean;
  feature: boolean;
  eligible_membership_ids: readonly string[];
}

/**
 * يختار عضوية التعديل التي يُنسب إليها الحد والسجل.
 * لا إعفاء للمسجّلة الأصلية: الغموض بين عدة عضويات ظاهر ولا يُحسم بأعلى حد.
 *
 * @param access حقائق العضويات المؤهلة للتعديل
 * @param selection العضوية المختارة، أو غياب الاختيار
 * @returns معرّف العضوية الواحدة أو المختارة
 */
export function resolveSessionEditor(
  access: SessionEditAccess,
  selection: string | undefined,
): string {
  if (access.denied || access.eligible_membership_ids.length === 0)
    throw new SessionError('FORBIDDEN');
  if (!access.feature) throw new SessionError('FEATURE_DISABLED');
  if (selection !== undefined) {
    if (!access.eligible_membership_ids.includes(selection)) throw new SessionError('FORBIDDEN');
    return selection;
  }
  if (access.eligible_membership_ids.length !== 1) {
    throw new SessionError('SESSION_EDITOR_MEMBERSHIP_REQUIRED', {
      editor_membership_ids: [...access.eligible_membership_ids],
    });
  }
  return access.eligible_membership_ids[0] as string;
}
