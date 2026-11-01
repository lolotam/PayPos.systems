import { z } from 'zod';
import { id as sharedId } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { sessionMoney } from './service-session.js';

const id = sharedId.toLowerCase();
const businessDate = z.iso.date();

// PK-Q4، أبو سالم: CARD هو KNET، ومفيش تحويل بنكي.
export const packagePaidMethod = z.enum(['CASH', 'CARD']).meta({ id: 'PackagePaidMethod' });

export const packageServiceRevision = z
  .strictObject({
    service_id: id,
    revision: z.number().int().positive(),
  })
  .meta({ id: 'PackageServiceRevision' });

export const sellPackageInput = z
  .strictObject({
    customer_id: id,
    package_type_id: id,
    expected_type_revision: z.number().int().positive(),
    // خدمة واحدة لكل مكوّن: تكرارها يخلّي مقارنة العرض ملتبسة (أنهي نسخة تتقارن؟).
    expected_service_revisions: z
      .array(packageServiceRevision)
      .min(1)
      .max(20)
      .refine((quote) => new Set(quote.map((entry) => entry.service_id)).size === quote.length),
    price_paid: sessionMoney,
    paid_method: packagePaidMethod,
    seller_employee_id: id,
    sold_at: timestamp.optional(),
    recorder_membership_id: id.optional(),
  })
  .meta({ id: 'SellPackageInput' });

export const soldPackageComponent = z
  .strictObject({
    id: id,
    service_id: id,
    position: z.number().int().min(1).max(20),
    name_en: z.string(),
    name_ar: z.string().nullable(),
    list_price_snapshot: sessionMoney,
    sessions_total: z.number().int().min(1).max(365),
    component_value: sessionMoney,
  })
  .meta({ id: 'SoldPackageComponent' });

export const soldPackageEntitlement = z
  .strictObject({
    id: id,
    business_id: id,
    customer_id: id,
    package_type_id: id,
    sold_branch_id: id,
    name_en: z.string(),
    name_ar: z.string().nullable(),
    validity_days: z.number().int().positive(),
    list_price: sessionMoney,
    price_paid: sessionMoney,
    discount: sessionMoney,
    discount_bps: z.number().int().min(0).max(10000),
    paid_method: packagePaidMethod,
    seller_employee_id: id,
    sold_at: timestamp,
    sold_business_date: businessDate,
    late: z.boolean(),
    expires_on: businessDate,
    refunded_amount: sessionMoney,
    revision: z.number().int().positive(),
    components: z.array(soldPackageComponent).min(1).max(20),
  })
  .meta({ id: 'SoldPackageEntitlement' });

// FR-010: 201 { entitlement }؛ صف الاستحقاق هو البيع نفسه (TD-1).
export const sellPackageResponse = z
  .strictObject({ entitlement: soldPackageEntitlement })
  .meta({ id: 'SellPackageResponse' });

// branch_id و business_date هما فرع البيع ويومه في كل نسخة، ومرتجع من فرع تاني ميغيّرهمش،
// عشان إسقاط العمولة (059 CM-20) يحدد شهر العمولة وفرع المصدر منهم (TD-7).
// و status ثابت 'SOLD' في المرحلة الأولى، محجوز لإلغاء بيع لاحقاً.
export const packageSaleChanged = z
  .strictObject({
    sale_id: id,
    business_id: id,
    branch_id: id,
    sold_at: timestamp,
    business_date: businessDate,
    seller_employee_id: id,
    price_paid: sessionMoney,
    refunded_amount: sessionMoney,
    status: z.literal('SOLD'),
    revision: z.number().int().positive(),
    schema_version: z.literal(1),
  })
  .meta({ id: 'PackageSaleChanged' });

export const packageSaleSchemas = [
  packagePaidMethod,
  packageServiceRevision,
  sellPackageInput,
  soldPackageComponent,
  soldPackageEntitlement,
  sellPackageResponse,
  packageSaleChanged,
];

export type PackagePaidMethod = z.infer<typeof packagePaidMethod>;
export type PackageServiceRevision = z.infer<typeof packageServiceRevision>;
export type SellPackageInput = z.infer<typeof sellPackageInput>;
export type SoldPackageComponent = z.infer<typeof soldPackageComponent>;
export type SoldPackageEntitlement = z.infer<typeof soldPackageEntitlement>;
export type SellPackageResponse = z.infer<typeof sellPackageResponse>;
export type PackageSaleChanged = z.infer<typeof packageSaleChanged>;
