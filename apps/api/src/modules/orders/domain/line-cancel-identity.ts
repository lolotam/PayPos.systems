import { assertEditorIsNotPerformer, type LineEditPerformer } from './line-edit-identity.ts';
import { SessionError } from './session-error.ts';

/**
 * يمنع إلغاء سطر نفّذته نفس المستخدمة، بدالة التعديل نفسها حتى لا ينشأ حكم ثانٍ.
 * المستدعي يمرّر منفّذات السطر الحالية ومعهن هويات من أزالتهن 37b؛ الدالة لا تميّز المصدر والفراغ لا يطابق.
 * سطر بلا لقطة يُترجم رمزه لأن جملة التعديل تقول «تتعدّل» بينما الإلغاء يقول «تتلغي».
 *
 * @param cancellerUserId مستخدمة الإلغاء
 * @param performers هويات المنفّذات المحفوظة والمتبقية بعد 37b
 * @returns لا شيء؛ التطابق أو غياب اللقطة يرفض
 */
export function assertCancellerIsNotPerformer(
  cancellerUserId: string,
  performers: readonly LineEditPerformer[],
): void {
  try {
    assertEditorIsNotPerformer(cancellerUserId, performers);
  } catch (error) {
    if (error instanceof SessionError && error.code === 'SESSION_EDIT_IDENTITY_UNKNOWN') {
      throw new SessionError('SESSION_LINE_IDENTITY_UNKNOWN');
    }
    throw error;
  }
}
