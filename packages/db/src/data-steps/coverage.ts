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
 * الواجهة الضيقة اللي بتستلمها جسم الخطوة: withTenant للمعاملات و close لإغلاق الـpool، ووبس.
 * مفيش withUser ولا withNewTenant ولا withMember ولا client خام، فمفيش مسار تاني لفتح معاملة
 * بيتخطى الإبطال — الالتفاف الوحيد حصل بره جسم الخطوة حسب إعلانها.
 */
export interface DataStepApp {
  withTenant: Database['withTenant'];
  close(): Promise<void>;
}

/** سياق البناء الذي تحتاجه أجسام الخطوات: باسورد dispatcher لخطوة واحدة ورابط المالك لبناء رابطها. */
export interface DataStepContext {
  readonly ownerUrl: string;
  readonly dispatcherPassword?: string;
}

/**
 * جسم الخطوة كما يراجعه code review: بياخد واجهة التطبيق الجاهزة من السجل ولا يبني واحدة بنفسه،
 * فقيمة الإعلان هي اللي بتحدد اغلفة بالإبطال أم لا (مصدر حقيقة واحد).
 */
export interface DataStepEntry {
  coverage: DataStepCoverage;
  run: (owner: postgres.Sql, app: DataStepApp, context: DataStepContext) => Promise<void>;
}

/** الشكل الذي يستهلكه المشغّل: جسم الخطوة مقفول على واجهته المبنيّة حسب إعلانه. */
export interface DataStep {
  coverage: DataStepCoverage;
  run: (owner: postgres.Sql) => Promise<void>;
}

/** خريطة الخطوات المسجّلة؛ قائمة السماح المراجَعة التي يقصّدها ADR-0054 §5. */
export type DataSteps = Readonly<Record<string, DataStep>>;

/** سبب الإبطال الثابت لمعاملات خطوات البيانات؛ يطابق CHECK النمط في 0250. */
export const DATA_STEP_INVALIDATION_REASON = 'DATA_STEP';

const REFUSAL = (name: string) =>
  `Migration data step ${name} carries no reviewed coverage declaration; migration aborted`;

/**
 * يرفض خطوة بيانات غير مراجَعة قبل أول جملة في التشغيل كله، بنفس مكان رفض العلامة المجهولة:
 * قيمة غايبة أو قيمة بره النوعين أو ليس كائناً أو بلا run دالة هو رفض، مش قراءة NONE.
 *
 * @param name  اسم الخطوة كما ورد في علامة الملف
 * @param entry القيد في السجل (كائن بـrun دالة وإعلان صحيح)
 */
export function reviewStep(name: string, entry: unknown): void {
  if (typeof entry !== 'object' || entry === null) throw new Error(REFUSAL(name));
  const candidate = entry as Partial<DataStep>;
  if (typeof candidate.run !== 'function') throw new Error(REFUSAL(name));
  if (candidate.coverage !== 'INVALIDATES' && candidate.coverage !== 'NONE')
    throw new Error(REFUSAL(name));
}

/**
 * يغلّف واجهة pospay_app لخطوة معلنة INVALIDATES بحيث كل withTenant يبدأ بإبطال التغطية
 * (invalidate_commission_coverage على معاملة الخطوة نفسها) قبل أول كتابة: كتابة مصدر صامتة
 * بين دفعتين كانت هتسيب إثباتاً قديماً حالياً (ADR-0054 §5)، والإبطال هنا يرفع الجيل في كل معاملة
 * من معاملات الخطوة، بمعرّف حالة جديد لكل معاملة.
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

/**
 * نقطة الالتفاف الوحيدة: الإعلان INVALIDATES يغلّف، وNONE يمرّر كما هو. السجل يستدعيها بقيمة
 * الإعلان المراجَعة نفسها، فجسم الخطوة لا يمكن أن يختار أو يبني واجهته بنفسه.
 *
 * @param app      واجهة التطبيق المقيدة بعزل الشركات
 * @param ids      مولّد UUID v7 للإبطال
 * @param coverage إعلان الخطوة المراجَع
 * @returns الواجهة التي تستلمها جسم الخطوة
 */
export function buildStepApp(app: Database, ids: IdGenerator, coverage: DataStepCoverage): Database {
  return coverage === 'INVALIDATES' ? invalidateCoverageInTenant(app, ids) : app;
}
