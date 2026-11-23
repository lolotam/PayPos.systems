import { sql } from 'drizzle-orm';

import type { Tx } from './with-tenant.ts';

/**
 * يبطل إثبات تغطية العمولات الحالي للشركة بزيادة توليد صف الحالة (ADR-0054 §5)، وهو الطريقة الوحيدة السليمة للإبطال:
 * الدالة تضمن صف الحالة ثم تزيده تحت قفل الصف، فيصير الإثبات القديم غير حالي وتغلق بوابة الاعتماد حتى إصدار إثبات جديد.
 * كل معاملة تكتب صفوف مصدر العمولة (سطور الخدمة، المؤدين، مبيعات الباقات، الرواتب، البقشيش) دون حدث محسوب تنادي
 * هذه الدالة أولًا؛ كاتب يتجاوزها يكتب بصمت ولا يُرى (ADR-0054 §12 بند 3(ب)).
 *
 * @param tx معاملة الشركة التي تكتب صفوف المصدر نفسها
 * @param stateId معرّف يُستعمل لو لم يوجد صف حالة للشركة بعد
 * @param reason سبب الإبطال بحروف كبيرة وشرطة سفلية، مثل PACKAGE_IMPORT
 * @returns التوليد الجديد لصف الحالة
 */
export async function invalidateCommissionCoverage(
  tx: Tx,
  stateId: string,
  reason: string,
): Promise<bigint> {
  const [row] = await tx.execute<{ generation: string }>(
    sql`SELECT public.invalidate_commission_coverage(${stateId}::uuid, ${reason})::text AS generation`,
  );
  if (row === undefined) throw new Error('The coverage invalidation returned no generation');
  return BigInt(row.generation);
}
