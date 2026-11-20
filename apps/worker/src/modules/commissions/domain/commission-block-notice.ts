/**
 * يقسم المستلمين لمجموعات متتالية ما تتجاوز مية، بعد حذف التكرار والترتيب
 * التصاعدي، لأن حدث الجرس بيقبل مية مستلم كحد أقصى (FR-049).
 *
 * @param userIds معرفات المستخدمين المؤهلين بالصلاحية
 * @param size حجم المجموعة الواحدة
 * @returns المجموعات بالترتيب التصاعدي؛ صفر مستلمين يعطي صفر مجموعات
 */
export function groupCommissionBlockNoticeRecipients(
  userIds: readonly string[],
  size: number,
): readonly (readonly string[])[] {
  const unique = [...new Set(userIds)].sort();
  const groups: string[][] = [];
  for (let index = 0; index < unique.length; index += size) {
    groups.push(unique.slice(index, index + size));
  }
  return groups;
}
