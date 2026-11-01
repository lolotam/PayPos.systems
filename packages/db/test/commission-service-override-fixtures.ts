import { sql } from 'drizzle-orm';
import postgres from 'postgres';

import type { IdGenerator, Tx } from '../src/index.ts';
import {
  COMMISSION_TENANT,
  OTHER_COMMISSION_IDS,
  seedCommissionStatementTenants,
  type CommissionTenant,
} from './commission-statement-fixtures.ts';
import { USER } from './tenancy-fixtures.ts';

/**
 * خدمات الكتالوج اللي بتتجاور مع التجاوزات: واحدة لكل شريحة، والتالتة في النشاط التاني
 * من نفس الشركة، عشان الـ FK المركّب يكون له هدف حقيقي غلط (نشاط تاني) مش معرّف مش موجود.
 */
export const SERVICE_OVERRIDE_IDS = {
  serviceA: '01920000-0000-7000-8000-00000000cf01',
  serviceB: '01920000-0000-7000-8000-00000000cf02',
  otherBusinessService: '01920000-0000-7000-8000-00000000cf03',
} as const;

export interface ServiceOverrideTenant extends CommissionTenant {
  /** خدمة الكتالوج في نفس النشاط — هدف الـ FK المركّب الصحيح. */
  readonly service: string;
}

export const SERVICE_OVERRIDE_TENANTS = {
  A: { ...COMMISSION_TENANT.A, service: SERVICE_OVERRIDE_IDS.serviceA },
  B: { ...COMMISSION_TENANT.B, service: SERVICE_OVERRIDE_IDS.serviceB },
} as const satisfies Record<string, ServiceOverrideTenant>;

/**
 * بيجهّز الشريحتين وخدمات الكتالوج بتاعتهم: خدمة لكل شريحة وثالثة في النشاط التاني من شركة A.
 * نوع القاعدة في الكتالوج أربع أنواع بس؛ FOLLOW_SERVICE نوع التجاوزات وحده (CS-Q39).
 *
 * @param ownerUrl اتصال كـ pospay_owner بداتابيز الاختبار
 * @returns بيخلص لما الـ fixtures تبقى موجودة
 */
export async function seedCommissionServiceOverrideTenants(ownerUrl: string): Promise<void> {
  await seedCommissionStatementTenants(ownerUrl);
  const owner = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
      VALUES(${COMMISSION_TENANT.A.company},${SERVICE_OVERRIDE_IDS.serviceA},${COMMISSION_TENANT.A.business},
        'Override service A',1.000,'ZERO')`;
    await owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
      VALUES(${COMMISSION_TENANT.B.company},${SERVICE_OVERRIDE_IDS.serviceB},${COMMISSION_TENANT.B.business},
        'Override service B',1.000,'ZERO')`;
    await owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
      VALUES(${COMMISSION_TENANT.A.company},${SERVICE_OVERRIDE_IDS.otherBusinessService},
        ${OTHER_COMMISSION_IDS.business},'Override other business service',1.000,'ZERO')`;
  } finally {
    await owner.end();
  }
}

/**
 * يدرج صف تجاوز واحد بقيم افتراضية صالحة؛ أي عمود في `row` بيتبدّل.
 * القيمة الثابتة للمبلغ بتتبعت نص عشان ما تتحوّلش لعدد عشري.
 *
 * @param tx     المعاملة الجارية — لازم تكون معاملة الشركة بتاعت الصف
 * @param tenant الشريحة صاحب الصف وخدمتها
 * @param ids    مولّد الـ ids
 * @param row    قيم تتجاوز الافتراضي (النوع وقيمة القاعدة والتاريخ والمُنشئ)
 * @returns بيخلص لما الصف يتكتب
 */
export async function insertCommissionServiceOverride(
  tx: Tx,
  tenant: ServiceOverrideTenant,
  ids: IdGenerator,
  row: Record<string, unknown> = {},
): Promise<void> {
  const value = (key: string, fallback: unknown) => (key in row ? row[key] : fallback);
  const rowId = 'id' in row ? row['id'] : ids.newId();
  await tx.execute(sql`INSERT INTO commission_service_overrides(
    company_id,id,business_id,employee_id,service_id,rule_kind,rule_pct_bps,rule_fixed_amount,
    effective_from,created_at,created_by)
    VALUES(${value('companyId', tenant.company)},${rowId},${value('businessId', tenant.business)},
      ${value('employeeId', tenant.employee)},${value('serviceId', tenant.service)},
      ${value('ruleKind', 'ZERO')},${value('rulePctBps', null)},${value('ruleFixedAmount', null)},
      ${value('effectiveFrom', '2026-11-01')},${value('createdAt', '2026-11-01T09:00:00Z')},
      ${value('createdBy', USER)})`);
}

/**
 * يبني إدراج صف تجاوز ناقص عمود واحد بس: باقي الأعمدة كاملة وصحيحة، فالمشكلة في الناقص وحده.
 * الأسماء جاية من قائمة ثابتة في الكود، فدمجها في النص مش مدخل من بره، والقيم كلّها معاملات مربوطة.
 *
 * @param tenant  الشريحة صاحب الصف وخدمتها
 * @param ids     مولّد الـ ids
 * @param missing اسم العمود اللي بيتنرك من الصف
 * @returns نص الاستعلام ومعاملاته
 */
export function commissionServiceOverrideInsertWithout(
  tenant: ServiceOverrideTenant,
  ids: IdGenerator,
  missing: string,
): { text: string; params: string[] } {
  const values: Record<string, string> = {
    company_id: tenant.company,
    id: ids.newId(),
    business_id: tenant.business,
    employee_id: tenant.employee,
    service_id: tenant.service,
    rule_kind: 'ZERO',
    effective_from: '2026-11-01',
    created_at: '2026-11-01T09:00:00Z',
    created_by: USER,
  };
  const present = Object.entries(values).filter(([column]) => column !== missing);
  const placeholders = present.map((_, index) => `$${index + 1}`);
  return {
    text: `INSERT INTO commission_service_overrides(${present.map(([column]) => column).join(', ')}) VALUES(${placeholders.join(', ')})`,
    params: present.map(([, fieldValue]) => fieldValue),
  };
}

/**
 * بيتأكد إن الشغل رُفض بكود خطأ معيّن وبقيد من قائمة أسماء مرشحة.
 * لو أكتر من مفتاح أجنبي اتكسر في نفس الصف، PostgreSQL بيبلّغ عن واحد بس حسب ترتيب التيجر،
 * فبنقبل أي واحد من الأسماء المرشحة بدل ما نثبّت اسم واحد مش مضمون.
 *
 * @param work        الشغل اللي المفروض يرفض
 * @param code        الـ SQLSTATE المتوقع
 * @param constraints أسماء القيود المرشحة
 * @returns بيخلص لما الرفض يبقى بالشكل المتوقع
 */
export async function expectPgErrorAmong(
  work: Promise<unknown>,
  code: string,
  constraints: readonly string[],
): Promise<void> {
  const { expect } = await import('vitest');
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  const failure = error as Error & {
    code?: string;
    constraint_name?: string;
    cause?: { code?: string; constraint_name?: string };
  };
  const source = failure.code ? failure : (failure.cause ?? failure);
  expect(source.code).toBe(code);
  expect(constraints).toContain(source.constraint_name);
}
