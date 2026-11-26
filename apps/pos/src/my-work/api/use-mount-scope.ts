import { useMountScope as useMountScopeFor } from '@/shared/query/use-mount-scope';

/** بادئة كل مفاتيح قراءات «شغلي» في زيارة واحدة للشاشة: هوية الموظفة ثم رقم الزيارة. */
export type MountScope = ReturnType<typeof useMountScopeFor>;

/**
 * مساحة مفاتيح خاصة بكل تركيب لشاشة «شغلي»، فزيارتان على نفس الـ client ما بيتشاركوش في كاش ولا طلب شغال.
 *
 * @param identity هوية الموظفة (بتتغيّر مع الجلسة)
 * @returns بادئة المفاتيح، ثابتة طول عمر التركيب
 */
export function useMountScope(identity: string): MountScope {
  return useMountScopeFor('my-work', identity);
}
