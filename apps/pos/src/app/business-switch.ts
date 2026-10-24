import type { PersonalWorkspace } from './manager-link';

/** نتيجة تغيير النشاط: اتبدّل، أو النت مش شغال، أو الفشل. */
export type SwitchOutcome = 'switched' | 'offline' | 'failed';

/** الحاجات اللي تغيير النشاط بيحتاجها من جوّه التطبيق. */
export interface SwitchBusinessIo {
  isOnline: () => boolean;
  endPersonalSession: () => Promise<'done' | 'failed'>;
  rememberBusiness: (workspace: PersonalWorkspace) => Promise<void>;
}

/**
 * بيبدّل النشاط المتذكر، بعد ما يخرج الجلسة الشخصية من السيرفر.
 *
 * الترتيب: النت، بعدين الخروج، بعدين الحفظ. من غير نت مفيش نداء خالص؛ والخروج
 * الفاشل معناها النشاط القديم يفضل زي ما هو؛ وفشل الحفظ بيطلع زي أي خطأ تاني
 * (خطوات الشاشة بتلمّه وتقول إن الحفظ فشل).
 *
 * @param next النشاط الجديد
 * @param io  الحاجات اللي التبديل بيحتاجها
 * @returns نتيجة التبديل
 */
export async function switchBusiness(
  next: PersonalWorkspace,
  io: SwitchBusinessIo,
): Promise<SwitchOutcome> {
  if (!io.isOnline()) return 'offline';
  const ended = await io.endPersonalSession();
  if (ended === 'failed') return 'failed';
  await io.rememberBusiness(next);
  return 'switched';
}
