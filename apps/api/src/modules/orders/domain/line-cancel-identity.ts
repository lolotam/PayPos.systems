import type { LineEditPerformer } from './line-edit-identity.ts';
import { assertActorIsNotPerformer } from './line-mutation-shared.ts';

/**
 * يمنع إلغاء سطر نفّذته نفس المستخدمة، بدالة التعديل نفسها حتى لا ينشأ حكم ثانٍ.
 * المستدعي يمرّر منفّذات السطر الحالية ومعهن هويات من أزالتهن 37b؛ الدالة لا تميّز المصدر والفراغ لا يطابق.
 * سطر بلا لقطة يُترجم رمزه هنا لأن جملة التعديل نفسها تقول «تتعدّل» وجملة السطر المشترك محايدة.
 *
 * @param cancellerUserId مستخدمة الإلغاء
 * @param performers هويات المنفّذات المحفوظة والمتبقية بعد 37b
 * @returns لا شيء؛ التطابق أو غياب اللقطة يرفض
 */
export function assertCancellerIsNotPerformer(
  cancellerUserId: string,
  performers: readonly LineEditPerformer[],
): void {
  assertActorIsNotPerformer(cancellerUserId, performers);
}
