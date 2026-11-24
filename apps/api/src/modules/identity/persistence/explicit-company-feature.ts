import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * يقرأ مفتاح ميزة شركة صريحًا بلا أي رجوع لباقة الشركة (ADR-0054 §9): الشركة غير محذوفة، وصف override موجود ومفعّل،
 * وانتهاؤه فارغ أو في المستقبل، ولا شيء غير ذلك. باقة تحمل نفس الاسم بقيمة true لا تفتح شيئًا.
 * يُستدعى بعد قفل صف حالة التغطية بعبارة مستقلة، فيرى ما التزم به أمر المشغّل قبل أن يفرج عن الصف. انتهاء الـoverride يُقاس
 * بلحظة القرار التي تُؤخذ بعد القفل لا بلحظة بداية المعاملة (`now()`)، فمفتاح انتهى وقت انتظار الطلب على الأقفال لا يفتح الاعتماد.
 *
 * @param tx معاملة الاعتماد نفسها، بسياق الشركة
 * @param companyId الشركة المؤكدة
 * @param flag اسم المفتاح
 * @param decisionAt لحظة القرار المأخوذة بعد القفل
 * @returns true فقط لو المفتاح مفتوح صراحةً وساري
 */
export async function readExplicitCompanyFeature(
  tx: Tx,
  companyId: string,
  flag: string,
  decisionAt: Date,
): Promise<boolean> {
  const [row] = await tx.execute<{ enabled: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM company_feature_overrides o JOIN companies c ON c.id = o.company_id
      WHERE o.company_id = ${companyId} AND o.flag = ${flag} AND o.enabled
        AND c.deleted_at IS NULL AND (o.expires_at IS NULL OR o.expires_at > ${decisionAt.toISOString()}::timestamptz)
    ) AS enabled`);
  return row?.enabled === true;
}
