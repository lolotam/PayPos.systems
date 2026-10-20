import type { LockedLinePerformer } from './line-edit.port.ts';

/**
 * قراءة الهويات المحفوظة لكل كتّاب السطر: موظفات أُزيلت من سطر فلزم أن يظلّن محظورات عليه.
 * الرابط الحالي لا يُقرأ هنا؛ يُقرأ بعد قفل الموظفات لأن القفل يسبق القراءة.
 */
export interface SessionLineIdentityPort {
  /**
   * يعيد كل هوية BEFORE لسطر واحد، حتى لو عادت الموظفة إليه مربوطة بمستخدم آخر.
   *
   * @param sessionId هوية الزيارة ضمن النشاط والفرع الحاليين
   * @param lineId هوية السطر
   * @returns لقطات الهوية بلا تكرار للثلاثي، أو مصفوفة فارغة
   */
  retainedForLine(sessionId: string, lineId: string): Promise<readonly LockedLinePerformer[]>;
  /**
   * يعيد كل هوية BEFORE لأسطر الزيارة كلها.
   *
   * @param sessionId هوية الزيارة ضمن النشاط والفرع الحاليين
   * @returns لقطات الهوية بلا تكرار للثلاثي، أو مصفوفة فارغة
   */
  retainedForSession(sessionId: string): Promise<readonly LockedLinePerformer[]>;
}
