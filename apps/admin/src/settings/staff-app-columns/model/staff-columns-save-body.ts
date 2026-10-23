import type { ReplaceStaffColumnsInput, StaffColumnsSettings } from '@pospay/contracts';

/** قيم الفورم: نفس مدخلات العقد، فالمُحلِّل (resolver) بيقبلها من غير تحويل. */
export type StaffColumnsDraft = ReplaceStaffColumnsInput;

/** الأعمدة مجموعة مش ترتيب، فالمقارنة بين مجموعتين بتتم على الأكواد نفسها. */
function sameColumns(left: readonly string[], right: readonly string[]): boolean {
  const chosen = new Set(left);
  const other = new Set(right);
  if (chosen.size !== other.size) return false;
  for (const code of chosen) if (!other.has(code)) return false;
  return true;
}

/**
 * جسم حفظ أعمدة تطبيق الموظفين: كل جزء بيبعت null لو قيمته لسه الافتراضي وما اتغيرتش.
 * السبب: الـ null هو «رجّعه للافتراضي»؛ النشاط اللي ما اختارش لازم يفضل ماشي على الافتراضي لحد ما يختار بنفسه.
 */
export function staffColumnsSaveBody(
  server: StaffColumnsSettings,
  draft: StaffColumnsDraft,
): ReplaceStaffColumnsInput {
  const columns = draft.columns ?? [];
  const monthsBack = draft.months_back ?? server.months_back;
  const keepColumns = server.columns_default && sameColumns(server.columns, columns);
  const keepMonths = server.months_back_default && monthsBack === server.months_back;
  return {
    columns: keepColumns ? null : columns,
    months_back: keepMonths ? null : monthsBack,
  };
}
