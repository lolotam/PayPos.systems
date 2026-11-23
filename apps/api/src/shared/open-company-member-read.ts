import type { TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { ApiError } from './errors.ts';

/**
 * معاملة قراءة واحدة بلقطة ثابتة لمسار جلسة بلا SelectedCompanyGuard (قراءة التقييمات في الأدمن): إثبات العضوية النشطة، ثم الشركة مفتوحة (مش محذوفة)، ثم فحص الصلاحية
 * والقراءة نفسها. كلها على نفس الاتصال واللقطة، فقرار «الشركة مفتوحة» والبيانات بيطلعوا من لحظة واحدة، ومفيش اتصال تاني من الـpool
 * (ميزانية الاتصالات في CLAUDE.md §6). مفيش عضوية سارية أو شركة مقفولة = FORBIDDEN، بنفس سلوك SelectedCompanyGuard.
 *
 * @param database مغلّفات الداتابيز
 * @param who المستخدم والشركة المختارة من الهيدر
 * @param who.userId المستخدم المثبت من الجلسة
 * @param who.companyId الشركة اللي اختارها العميل ويتأكد إنه عضو فيها
 * @param run الفحص والقراءة على المعاملة نفسها
 * @returns نتيجة run
 */
export async function readAsMemberOfOpenCompany<T>(
  database: TenantWrappers,
  who: { readonly userId: string; readonly companyId: string },
  run: (tx: Tx) => Promise<T>,
): Promise<T> {
  const outcome = await database.withMember(
    who.userId,
    who.companyId,
    async (tx) => {
      const company = await tx.execute(
        sql`SELECT id FROM companies WHERE id = ${who.companyId} AND deleted_at IS NULL`,
      );
      return company.length === 0 ? null : { value: await run(tx) };
    },
    { readOnly: true },
  );
  if (outcome === null) throw new ApiError('FORBIDDEN');
  return outcome.value;
}
