import { z } from 'zod';

import { nameAr, nameEn } from '../bilingual/names.js';
import { page } from '../pagination/cursor.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

// المال بيتنقل كنص بـ 3 خانات عشرية دايماً؛ رقم JS كان بيضيّع فلوس (CLAUDE.md §5).
// نفس حد salaryAmount: numeric(14,3) يعني 11 خانة صحيحة على الأكثر.
const servicePrice = z
  .string()
  .regex(/^(0|[1-9]\d{0,10})\.\d{3}$/)
  .meta({ id: 'ServicePrice' });

// نسبة العمولة بوحدات bps (0–10000) مش وحدات Percentage (0–100 بمقياس)؛ والمبلغ الثابت بالفلس كنص.
export const serviceCommissionRule = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('FOLLOW_PLAN') }),
    z.strictObject({ kind: z.literal('ZERO') }),
    z.strictObject({ kind: z.literal('PCT'), value: z.number().int().min(0).max(10_000) }),
    z.strictObject({ kind: z.literal('FIXED'), value: servicePrice }),
  ])
  .meta({ id: 'ServiceCommissionRule' });

const serviceFields = {
  name_en: nameEn,
  name_ar: nameAr.nullable().optional(),
  price: servicePrice,
  commission_rule: serviceCommissionRule,
  counts_toward_threshold: z.boolean().optional(),
};

export const createServiceInput = z.strictObject(serviceFields).meta({ id: 'CreateServiceInput' });

const revision = z.number().int().min(1).max(2_147_483_646);
// استبدال كامل للحقول القابلة للتعديل مقابل النسخة المتوقعة، زي update-employee.
export const updateServiceInput = z
  .strictObject({
    expected_revision: revision,
    ...serviceFields,
  })
  .meta({ id: 'UpdateServiceInput' });

export const service = z
  .object({
    id,
    business_id: id,
    name_en: nameEn,
    name_ar: nameAr.nullable(),
    price: servicePrice,
    commission_rule: serviceCommissionRule,
    counts_toward_threshold: z.boolean(),
    revision,
    created_at: timestamp,
    updated_at: timestamp,
  })
  .meta({ id: 'Service' });

export const serviceListItem = service
  .pick({
    id: true,
    name_en: true,
    name_ar: true,
    price: true,
    commission_rule: true,
    counts_toward_threshold: true,
    revision: true,
  })
  .meta({ id: 'ServiceListItem' });

export const servicePage = page(serviceListItem).meta({ id: 'ServicePage' });

export const serviceListQuery = z
  .strictObject({
    cursor: id.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .meta({ id: 'ServiceListQuery' });

// كل مخطط منشور لازم يسجّل في OpenAPI (تشمل المكوّنات المتداخلة) عشان الـ client المولّد يلاقيه.
export const serviceSchemas = [
  servicePrice,
  serviceCommissionRule,
  createServiceInput,
  updateServiceInput,
  service,
  serviceListItem,
  servicePage,
  serviceListQuery,
];
export type CreateServiceInput = z.infer<typeof createServiceInput>;
export type UpdateServiceInput = z.infer<typeof updateServiceInput>;
export type Service = z.infer<typeof service>;
export type ServiceListItem = z.infer<typeof serviceListItem>;
export type ServicePage = z.infer<typeof servicePage>;
export type ServiceListQuery = z.infer<typeof serviceListQuery>;
export type ServiceCommissionRuleInput = z.infer<typeof serviceCommissionRule>;
