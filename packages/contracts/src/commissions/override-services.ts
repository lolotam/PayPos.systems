import { z } from 'zod';

import { service, serviceCommissionRuleView } from '../catalog/service.js';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import type { CommissionServiceOverrideRuleView } from './service-overrides.js';
import { commissionPlanDate } from './plan-versions.js';

/**
 * استعلام قائمة خدمات شاشة العمولة الخاصة (FR-013a): المؤشر معرّف خدمة (ترتيب الخدمات كلها
 * بمعرّفها) والحد بيقبل 100 صف بالكتير. الاستعلام صارم: أي مفتاح زيادة فيه 400،
 * فالعميل ما يقدرش يمرّر فلتر ما الشاشة بتعرضه.
 */
export const commissionOverrideServiceListQuery = z
  .strictObject({
    cursor: id.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .meta({ id: 'CommissionOverrideServiceListQuery' });

/**
 * التجاوز الحالي لخدمة الموظفة: السطر الوحيد اللي المحرك بيطبّقه النهاردة (مؤهّل بتاريخ اليوم
 * بتوقيت النشاط والأحدث بين المؤهلين بـ (created_at, id)). `null` معناها مفيش تجاوز مؤهّل —
 * العميل ممنوع يقرأها «صفر» ولا «اتباع الخطة» (CM-12): غياب التجاوز بيرجّع للقطة سطر البيع نفسه.
 */
export const commissionOverrideServiceCurrentOverride = responseObject({
  id,
  rule: serviceCommissionRuleView,
  effective_from: commissionPlanDate,
  created_at: timestamp,
}).meta({ id: 'CommissionOverrideServiceCurrentOverride' });

/**
 * صف الخدمة في جدول الشاشة (CS-Q49 = PP-206.1): الاسم وعمولة الخدمة المكتوبة في الكتالوج
 * وسعرها، ومفيش مدة ولا تصنيف — صلاحية خطط العمولة بتوسّع شوفتها للحقول دي بس.
 * المقفولة بتظهر بـ `closed_at` وتفضل قابلة للتعديل (CS-Q50 = PP-206.2).
 */
export const commissionOverrideServiceItem = responseObject({
  service_id: id,
  name_en: z.string(),
  name_ar: z.string().nullable(),
  closed_at: timestamp.nullable(),
  service_rule: serviceCommissionRuleView,
  price: service.shape.price,
  current_override: commissionOverrideServiceCurrentOverride.nullable(),
}).meta({ id: 'CommissionOverrideServiceItem' });

/**
 * صفحة القائمة: 100 صف بالكتير، و`next_cursor` هو معرّف آخر خدمة في الصفحة (null لو دي الأخيرة)
 * عشان الصفحة الجاية تكمل من بعده بترتيب معرّف الخدمة زي كل قوائم الخدمات.
 */
export const commissionOverrideServiceList = responseObject({
  items: z.array(commissionOverrideServiceItem).max(100),
  next_cursor: id.nullable(),
}).meta({ id: 'CommissionOverrideServiceList' });

// `ServicePrice` و`ServiceCommissionRule` متسجلين قبل كده من سكيما الكتالوج، فالجديد هنا بس
// سكيماات القائمة الأربعة — والقاعدة المعاد استخدامها بتفضل مكون واحد مش نسخة تانية.
export const commissionOverrideServiceSchemas = [
  commissionOverrideServiceListQuery,
  commissionOverrideServiceCurrentOverride,
  commissionOverrideServiceItem,
  commissionOverrideServiceList,
];

export type CommissionOverrideServiceListQuery = z.infer<typeof commissionOverrideServiceListQuery>;

/** صف خدمة شاشة التجاوزات كما يقرأه قارئ الكتالوج (CS-Q49: الاسم والقاعدة والسعر، وCS-Q50 الإغلاق). */
export type CommissionOverrideServiceRow = {
  readonly id: string;
  readonly name_ar: string | null;
  readonly name_en: string;
  readonly price: string;
  readonly closed_at: string | null;
  readonly rule: CommissionServiceOverrideRuleView;
};

/** صفحة خدمات شاشة التجاوزات: العناصر ومفتاح آخر خدمة للصفحة الجاية (null في الأخيرة). */
export type CommissionOverrideServicePage = {
  readonly items: readonly CommissionOverrideServiceRow[];
  readonly next_cursor: string | null;
};

export type CommissionOverrideServiceCurrentOverride = z.infer<
  typeof commissionOverrideServiceCurrentOverride
>;
export type CommissionOverrideServiceItem = z.infer<typeof commissionOverrideServiceItem>;
export type CommissionOverrideServiceList = z.infer<typeof commissionOverrideServiceList>;
