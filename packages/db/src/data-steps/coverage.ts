import { sql } from 'drizzle-orm';
import type postgres from 'postgres';

import type { Database } from '../client.ts';
import type { IdGenerator } from '../with-tenant.ts';

/**
 * إعلان التغطية لكل خطوة بيانات مسجّلة (ADR-0054 §5): الخطوة اللي بتكتب صفوف مصدر مغطّاة بإثبات
 * التغطية لازم تعلن INVALIDATES، واللي ما بتلمسش تلك الجداول تعلن NONE صراحةً.
 * غياب الإعلان أو قيمته المجهولة رفض تشغيل، مش NONE — غياب الإعلان مش نفس إعلان عدم التأثير.
 */
export type DataStepCoverage = 'INVALIDATES' | 'NONE';

/**
 * شكل الخطوة المسجّلة: دالة التشغيل نفسها مع إعلان تغطيتها، فالمسجل هو قائمة السماح المراجَعة
 * (كل خطوة لاسمها وقيمتها مكتوبتين صراحةً في code review).
 */
export interface DataStep {
  run: (owner: postgres.Sql) => Promise<void>;
  coverage: DataStepCoverage;
}

/** خريطة الخطوات المسجّلة؛ قائمة السماح المراجَعة التي يقصّدها ADR-0054 §5. */
export type DataSteps = Readonly<Record<string, DataStep>>;

/** سبب الإبطال الثابت لمعاملات خطوات البيانات؛ يطابق CHECK النمط في 0250. */
export const DATA_STEP_INVALIDATION_REASON = 'DATA_STEP';

/**
 * يرفض خطوة بيانات من غير إعلان تغطية مراجَع قبل أول جملة في التشغيل كله، بنفس مكان رفض
 * العلامة المجهولة: إعلان غايب أو قيمة بره النوعين هو رفض، مش قراءة NONE.
 *
 * @param name     اسم الخطوة كما ورد في علامة الملف
 * @param coverage قيمة الإعلان المكتوبة في السجل
 */
export function reviewCoverage(name: string, coverage: unknown): void {
  if (coverage !== 'INVALIDATES' && coverage !== 'NONE')
    throw new Error(
      `Migration data step ${name} carries no reviewed coverage declaration; migration aborted`,
    );
}

/**
 * يغلّف واجهة pospay_app لخطوة معلنة INVALIDATES بحيث كل withTenant يبدأ بإبطال التغطية
 * (invalidate_commission_coverage على معاملة الخطوة نفسها) قبل أول كتابة: كتابة مصدر صامتة
 * بين دفعتين كانت هتسيب إثباتاً قديماً حالياً (ADR-0054 §5)، والإبطال هنا يرفع الجيل في كل معاملة
 * من معاملات الخطوة.
 *
 * @param app واجهة التطبيق المقيدة بعزل الشركات
 * @param ids مولّد UUID v7 لصف الحالة لو ضاع الـ ensure أول مرة
 * @returns نفس الواجهة و withTenant يبدأ بالإبطال ثم شغل الخطوة
 */
export function invalidateCoverageInTenant(app: Database, ids: IdGenerator): Database {
  return {
    ...app,
    withTenant: (companyId, work, transactionOptions = {}) =>
      app.withTenant(
        companyId,
        async (tx) => {
          await tx.execute(
            sql`SELECT public.invalidate_commission_coverage(${ids.newId()}::uuid, ${DATA_STEP_INVALIDATION_REASON})`,
          );
          return work(tx);
        },
        transactionOptions,
      ),
  };
}
