import { resolveSessionEditor, type SessionEditAccess } from './line-edit-editor.ts';
import { SessionError } from './session-error.ts';

/**
 * يختار عضوية تغيير المنفّذين التي يُنسب إليها السجل، بنفس قاعدة اختيار المحررة ومن غير إعادة تقييم الصلاحية.
 * عدة عضويات بلا اختيار تُترجم إلى رمز تغيير المنفّذين لأن رمز التعديل يحمل جملة التعديل.
 * معرّف ليس بين المؤهلات يبقى منعاً موحّداً حتى لا يكشف العضويات.
 *
 * @param access حقائق العضويات المؤهلة لتغيير المنفّذين
 * @param selection العضوية المختارة، أو غياب الاختيار
 * @returns معرّف العضوية الواحدة أو المختارة
 */
export function resolveSessionChanger(
  access: SessionEditAccess,
  selection: string | undefined,
): string {
  try {
    return resolveSessionEditor(access, selection);
  } catch (error) {
    if (!(error instanceof SessionError) || error.code !== 'SESSION_EDITOR_MEMBERSHIP_REQUIRED') {
      throw error;
    }
    const details = error.details as { editor_membership_ids: readonly string[] };
    throw new SessionError('SESSION_CHANGER_MEMBERSHIP_REQUIRED', {
      changer_membership_ids: [...details.editor_membership_ids],
    });
  }
}
