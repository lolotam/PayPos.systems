import { CommissionBlockNoticeGroupSizeError } from './errors.ts';

/**
 * يقسم المستلمين لمجموعات متتالية ما تتجاوز مية، بعد حذف التكرار والترتيب
 * التصاعدي، لأن حدث الجرس بيقبل مية مستلم كحد أقصى (FR-049). الحجم لازم يكون
 * عدد صحيح موجب؛ صفر أو سالب يعني لفّة لامتناهية وكسر يعني مجموعات مشوّهة.
 *
 * @param userIds معرفات المستخدمين المؤهلين بالصلاحية
 * @param size حجم المجموعة الواحدة، عدد صحيح موجب
 * @returns المجموعات بالترتيب التصاعدي؛ صفر مستلمين يعطي صفر مجموعات
 */
export function groupCommissionBlockNoticeRecipients(
  userIds: readonly string[],
  size: number,
): readonly (readonly string[])[] {
  if (!Number.isInteger(size) || size < 1) throw new CommissionBlockNoticeGroupSizeError(size);
  const unique = [...new Set(userIds)].sort();
  const groups: string[][] = [];
  for (let index = 0; index < unique.length; index += size) {
    groups.push(unique.slice(index, index + size));
  }
  return groups;
}
