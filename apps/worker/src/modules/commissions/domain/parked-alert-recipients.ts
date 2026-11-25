/**
 * يقسم مستلمي تنبيه الحدث الموقوف إلى مجموعات متتالية ما تتجاوز السقف، بعد حذف
 * التكرار والترتيب التصاعدي، لأن عقد الإشعار بيقبل مية مستلم في الحدث الواحد.
 * الحجم لازم يكون عدد صحيح موجب؛ صفر أو سالب معناها لفّة لامتناهية.
 *
 * @param userIds معرفات مالكي الشركة
 * @param size حجم المجموعة الواحدة، عدد صحيح موجب
 * @returns المجموعات بالترتيب التصاعدي؛ صفر مستلمين يعني صفر مجموعات
 */
export function groupParkedAlertRecipients(
  userIds: readonly string[],
  size: number,
): readonly (readonly string[])[] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`Invalid parked alert group size: ${size}`);
  }
  const unique = [...new Set(userIds)].sort();
  const groups: string[][] = [];
  for (let index = 0; index < unique.length; index += size) {
    groups.push(unique.slice(index, index + size));
  }
  return groups;
}
