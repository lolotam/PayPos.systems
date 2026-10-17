/** الجسم الكامل بشكل بنيوي؛ الحقول الزائدة تبقى لأن النطاق لا يستورد العقد. */
export interface EditServiceLineResponseFull {
  line: { edited: true };
  session: { id: string; total_net: string };
}

/** رد من لا تملك قراءة الزيارات: علامة الحفظ فقط، من غير أي رقم. */
export interface EditServiceLineResponseNarrow {
  saved: true;
  edited: true;
}

export type EditServiceLineResponse = EditServiceLineResponseFull | EditServiceLineResponseNarrow;

/**
 * يسقط أرقام التعديل عمّن لا تملك قراءة الزيارات، بما في ذلك إعادة الإرسال.
 * الجسم الكامل يُحفظ مرة واحدة، والعرض يُحسب في كل رد من صلاحية القراءة الحالية.
 *
 * @param full جسم التعديل الكامل
 * @param canRead هل للطالبة قراءة زيارات الفرع
 * @returns الجسم الكامل كما هو، أو علامة الحفظ فقط
 */
export function projectEditResponse<T extends EditServiceLineResponseFull>(
  full: T,
  canRead: boolean,
): T | EditServiceLineResponseNarrow {
  if (canRead) return full;
  return { saved: true, edited: true };
}
