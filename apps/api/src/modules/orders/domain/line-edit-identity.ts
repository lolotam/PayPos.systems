import { SessionError } from './session-error.ts';

/** لقطة منفّذة وقت التسجيل وربطها الحالي؛ كلا المعرّفين قد يكون فارغاً. */
export interface LineEditPerformer {
  linked_user_id: string | null;
  linked_user_snapshotted: boolean;
  current_user_id: string | null;
}

/**
 * يمنع تعديل سطر نفّذته نفس المستخدمة، باللقطة أو بالربط الحالي.
 * سطر بلا لقطة، أو بلا منفّذات، يُرفض قبل المقارنة لأن الهوية لا تُثبَت وفراغ لا يطابق أحداً.
 * المقارنة بعد تصغير الحالتين حتى لا يفلت معرّف مكتوب بحروف مختلفة.
 *
 * @param editorUserId مستخدمة التعديل
 * @param performers منفّذات السطر وقت التعديل
 * @returns لا شيء؛ التطابق أو غياب اللقطة يرفض
 */
export function assertEditorIsNotPerformer(
  editorUserId: string,
  performers: readonly LineEditPerformer[],
): void {
  if (
    performers.length === 0 ||
    performers.some((performer) => performer.linked_user_snapshotted === false)
  ) {
    throw new SessionError('SESSION_EDIT_IDENTITY_UNKNOWN');
  }
  const editorKey = editorUserId.toLowerCase();
  const sameUser = (candidate: string | null) =>
    candidate !== null && candidate.toLowerCase() === editorKey;
  if (
    performers.some(
      (performer) => sameUser(performer.linked_user_id) || sameUser(performer.current_user_id),
    )
  ) {
    throw new SessionError('SESSION_PERFORMER_SELF_FORBIDDEN');
  }
}
