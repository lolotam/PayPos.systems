import type { CommissionServiceOverride, CreateCommissionServiceOverrideInput } from '@pospay/contracts';
import type { Tx } from '@pospay/db';

import {
  businessCalendar,
  lockEmployeeForUpdate,
  readCommissionPlanAccess,
  readSessionServices,
} from '../../../../test/harness.ts';
import type { CommissionInputLockReaders } from '../persistence/commission-input-lock-scope.ts';
import { createCommissionServiceOverrideScope } from '../persistence/commission-service-override-scope.ts';
import { createCommissionServiceOverrideTransactions } from '../persistence/drizzle-commission-service-override-transactions.ts';
import type {
  CommissionServiceOverrideTransactions,
  CreateCommissionServiceOverrideCommand,
} from '../ports/commission-service-override-transactions.port.ts';
import {
  CreateCommissionServiceOverrideUseCase,
  writeCommissionServiceOverride,
} from '../use-cases/create-commission-service-override/create-commission-service-override.usecase.ts';
import {
  COMMISSION_NOW,
  commissionPlanVersionsFixture,
  ids,
} from './commission-plan-versions.fixture.ts';

/** يوم الكتابة في معيار النشاط: نفس ساعة writers الإصدارات عشان القواعد تتقارن. */
export const OVERRIDE_NOW = COMMISSION_NOW;

type CommissionHarness = Awaited<ReturnType<typeof commissionPlanVersionsFixture>>;

async function seedService(
  h: CommissionHarness['h'],
  company: string,
  business: string,
  name: string,
): Promise<string> {
  const service = ids.newId();
  await h.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES (${company},${service},${business},${name},10.000,'ZERO')`;
  return service;
}

export async function commissionServiceOverridesFixture() {
  const plan = await commissionPlanVersionsFixture();
  const { h } = plan;
  const service = await seedService(h, plan.company, plan.business, 'Override service');
  const otherBusinessResponse = await h.send('POST', '/v1/businesses', {
    cookie: plan.cookie,
    company: plan.company,
    key: 'commission-override-other-business',
    body: { vertical_type: 'salon', name_en: 'Override other business', timezone: 'Asia/Kuwait' },
  });
  const otherBusiness = otherBusinessResponse.body['id'] as string;
  const otherBusinessService = await seedService(
    h,
    plan.company,
    otherBusiness,
    'Override other business service',
  );
  const otherCompany = await h.onboard(plan.cookie, 'Override other company');
  const otherTenantBusinessResponse = await h.send('POST', '/v1/businesses', {
    cookie: plan.cookie,
    company: otherCompany,
    key: 'commission-override-other-tenant',
    body: { vertical_type: 'salon', name_en: 'Override other tenant business', timezone: 'Asia/Kuwait' },
  });
  const otherTenantService = await seedService(
    h,
    otherCompany,
    otherTenantBusinessResponse.body['id'] as string,
    'Override other tenant service',
  );
  const readers = {
    businessCalendar,
    employeeLock: lockEmployeeForUpdate,
    access: readCommissionPlanAccess,
    // وجود الخدمة بس: قاعدة الكتالوج الحية مش مرجع تاريخ، واللقطة المحفوظة على السطر هي المرجع.
    serviceReader: async (tx: Tx, companyId: string, businessId: string, serviceId: string) =>
      (await readSessionServices(tx, companyId, businessId, [serviceId])).length > 0,
  };
  return {
    ...plan,
    readers,
    service,
    otherBusiness,
    otherBusinessService,
    otherCompany,
    otherTenantService,
  };
}

export type CommissionServiceOverrideFixture = Awaited<
  ReturnType<typeof commissionServiceOverridesFixture>
>;

export function overrideInput(
  f: CommissionServiceOverrideFixture,
  patch: Partial<CreateCommissionServiceOverrideInput> = {},
): CreateCommissionServiceOverrideInput {
  return {
    service_id: f.service,
    rule: { kind: 'PCT', value: 1500 },
    effective_from: '2026-10-30',
    ...patch,
  };
}

export function overrideCommand(
  f: CommissionServiceOverrideFixture,
  input: CreateCommissionServiceOverrideInput,
  key: string,
  fingerprint = 'a'.repeat(64),
  employeeId = f.employee,
  userId = f.userId,
): CreateCommissionServiceOverrideCommand {
  return {
    companyId: f.company,
    userId,
    businessId: f.business,
    employeeId,
    input,
    key,
    fingerprint,
  };
}

/** خيارات تغيّر مسار الكتابة: الموظفة والساعة والبصمة والمستخدم الفاعل. */
export interface OverrideWriteOptions {
  readonly fingerprint?: string;
  readonly clock?: { now(): Date };
  readonly employeeId?: string;
  readonly userId?: string;
}

/**
 * يشغّل كاتب التجاوز على معاملة الشركة، زي ما مسار HTTP هيشغّله بعد التركيب.
 *
 * @param f       خط الفحص بستافاته الثابتة
 * @param input   جسم الإنشاء بالعقد
 * @param key     مفتاح إعادة الإرسال
 * @param options الموظفة والساعة والبصمة اللي بتتغيّر في السيناريو
 * @returns الصف المخزن بعد الكتابة والتدقيق
 */
export async function writeOverride(
  f: CommissionServiceOverrideFixture,
  input: CreateCommissionServiceOverrideInput,
  key: string,
  options: OverrideWriteOptions = {},
): Promise<CommissionServiceOverride> {
  const command = overrideCommand(
    f,
    input,
    key,
    options.fingerprint ?? 'a'.repeat(64),
    options.employeeId ?? f.employee,
    options.userId ?? f.userId,
  );
  const actorId = options.userId ?? f.userId;
  return f.db.withTenant(
    f.company,
    (tx) =>
      writeCommissionServiceOverride(
        createCommissionServiceOverrideScope(tx, command, ids, f.readers),
        command,
        ids,
        options.clock ?? { now: () => OVERRIDE_NOW },
      ),
    { userId: actorId },
  );
}

/** يشغّل الكاتب من خلال غلاف المعاملة الذرية، عشان إعادة الإرسال تُفحص على طريقتها الحقيقية. */
export function overrideTransactions(
  f: CommissionServiceOverrideFixture,
): CommissionServiceOverrideTransactions {
  return createCommissionServiceOverrideTransactions(f.db, ids, f.readers);
}

/**
 * يشغّل حالة الاستخدام كاملة: معاملة الشركة والمطالبة الذرية والرد المخزن.
 *
 * @param f       خط الفحص بستافاته الثابتة
 * @param input   جسم الإنشاء بالعقد
 * @param key     مفتاح إعادة الإرسال
 * @param options الموظفة والساعة والبصمة اللي بتتغيّر في السيناريو
 * @returns الصف المخزن أو رد إعادة الإرسال المخزن
 */
export async function runOverride(
  f: CommissionServiceOverrideFixture,
  input: CreateCommissionServiceOverrideInput,
  key: string,
  options: OverrideWriteOptions = {},
): Promise<CommissionServiceOverride> {
  const command = overrideCommand(
    f,
    input,
    key,
    options.fingerprint ?? 'a'.repeat(64),
    options.employeeId ?? f.employee,
    options.userId ?? f.userId,
  );
  const useCase = new CreateCommissionServiceOverrideUseCase(
    overrideTransactions(f),
    ids,
    options.clock ?? { now: () => OVERRIDE_NOW },
  );
  return useCase.execute(command);
}

/**
 * يبني غلاف المعاملة الذرية بقارئ صلاحية بديل، لإثبات إعادة الفحص الأخيرة تحت الأقفال.
 *
 * @param f      خط الفحص بستافاته الثابتة
 * @param access قرار الصلاحية البديل: null للسماح، أو كود الرفض
 * @returns غلاف المعاملة الذرية بالقارئ البديل
 */
export function overrideTransactionsWithAccess(
  f: CommissionServiceOverrideFixture,
  access: CommissionInputLockReaders['access'],
): CommissionServiceOverrideTransactions {
  return createCommissionServiceOverrideTransactions(f.db, ids, { ...f.readers, access });
}

export async function overrideAndAuditCounts(
  f: CommissionServiceOverrideFixture,
): Promise<readonly [number, number]> {
  const [overrides] =
    await f.h.owner`SELECT count(*)::int AS count FROM commission_service_overrides
      WHERE company_id=${f.company}`;
  const [audits] = await f.h.owner`SELECT count(*)::int AS count FROM audit_log
    WHERE company_id=${f.company} AND action='commission_override.created'`;
  return [overrides?.['count'] as number, audits?.['count'] as number];
}

export async function idempotencyClaims(f: CommissionServiceOverrideFixture): Promise<number> {
  const [row] = await f.h.owner`SELECT count(*)::int AS count FROM idempotency_keys
    WHERE company_id=${f.company} AND operation='create-commission-service-override'`;
  return row?.['count'] as number;
}

export async function savedOverrideRows(f: CommissionServiceOverrideFixture): Promise<
  {
    readonly id: string;
    readonly employee_id: string;
    readonly service_id: string;
    readonly rule_kind: string;
    readonly rule_pct_bps: number | null;
    readonly rule_fixed_amount: string | null;
    readonly effective_from: string;
    readonly created_by: string;
  }[]
> {
  return f.h.owner`SELECT id,employee_id,service_id,rule_kind,rule_pct_bps,
    rule_fixed_amount::text AS rule_fixed_amount,to_char(effective_from,'YYYY-MM-DD') AS effective_from,
    created_by FROM commission_service_overrides WHERE company_id=${f.company} ORDER BY created_at,id`;
}
