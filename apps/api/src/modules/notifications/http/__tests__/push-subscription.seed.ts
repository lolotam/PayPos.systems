import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AuthService } from '@pospay/auth';
import { PROVISIONAL_PLAN_ID } from '@pospay/db';
import { employeeNameMatchKey } from '@pospay/domain';
import postgres from 'postgres';

import { takeTestEmployeeNumber } from '../../../../../test/test-employee-number.ts';

export const personalOrigin = 'http://localhost:5173';
export const adminOrigin = 'http://admin.test';

/** ما يحتاجه الزرع: اتصال المالك ومولّد المعرفات ورقم تليفون جديد. */
export interface SeedContext {
  readonly owner: postgres.Sql;
  readonly ids: { newId(): string };
  readonly nextPhone: () => string;
}

/**
 * @param owner اتصال المالك
 * @param ids   مولّد المعرفات
 * @returns سياق الزرع
 */
export function createSeedContext(
  owner: postgres.Sql,
  ids: { newId(): string },
): SeedContext {
  let phone = 0;
  return {
    owner,
    ids,
    nextPhone: () => `+9655550000${(phone += 1)}`,
  };
}

/** شركة ونشاط وفرع جاهزين للربط. */
export interface CompanyRows {
  readonly companyId: string;
  readonly businessId: string;
  readonly branchId: string;
}

/** جلسة شخصية جاهزة: الـ cookie اللي بيتبعت مع كل طلب. */
export interface StaffSession {
  readonly userId: string;
  readonly companyId: string;
  readonly cookie: string;
  readonly headers: Record<string, string>;
}

/**
 * @param seed      اتصال المالك ومولّد المعرفات
 * @param label     اسم الشركة
 * @param ownerUserId صاحب الشركة
 * @returns الشركة والنشاط والفرع
 */
export async function seedCompanyRows(
  seed: SeedContext,
  label: string,
  ownerUserId: string,
): Promise<CompanyRows> {
  const companyId = seed.ids.newId();
  const businessId = seed.ids.newId();
  const branchId = seed.ids.newId();
  await seed.owner`INSERT INTO companies(id,name_en,owner_user_id,plan_id)
    VALUES(${companyId},${label},${ownerUserId},${PROVISIONAL_PLAN_ID})`;
  await seed.owner`INSERT INTO businesses(company_id,id,name_en,vertical_type)
    VALUES(${companyId},${businessId},${label},'salon')`;
  await seed.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES(${companyId},${branchId},${businessId},${label})`;
  await seed.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    SELECT ${companyId},${seed.ids.newId()},${ownerUserId},id,'global','BRANCH',${branchId}
    FROM roles WHERE code='staff' AND company_id IS NULL`;
  return { companyId, businessId, branchId };
}

/**
 * @param seed            اتصال المالك ومولّد المعرفات
 * @param label           اسم الموظف
 * @param employeeUserId  المستخدم المرتبط بالموظف
 * @param company         الشركة والنشاط والفرع
 */
export async function seedEmployee(
  seed: SeedContext,
  label: string,
  employeeUserId: string,
  company: CompanyRows,
): Promise<void> {
  const employeeId = seed.ids.newId();
  await seed.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,user_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${company.companyId},${employeeId},${company.businessId},${company.branchId},${employeeUserId},${label},
      ${employeeNameMatchKey(label)},'staff','2026-01-01',${takeTestEmployeeNumber(company.companyId)})`;
  await seed.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${company.companyId},${seed.ids.newId()},${company.businessId},${employeeId},${company.branchId},'2026-01-01')`;
}

/**
 * @param seed  اتصال المالك ومولّد المعرفات
 * @param label اسم المستخدم
 * @param phone رقم التليفون المرتبط
 * @returns معرّف المستخدم
 */
export async function seedUser(
  seed: SeedContext,
  label: string,
  phone: string,
): Promise<string> {
  const userId = seed.ids.newId();
  // البريد بيتحسب في جافاسكربت: الـ @ جوّه قالب postgres.js بيتقرا معامل ناقص.
  const email = `${label.replaceAll(' ', '-')}@example.test`;
  await seed.owner`INSERT INTO "user"(id,name,email,phone_number,phone_binding_approved_at)
    VALUES(${userId},${label},${email},${phone},clock_timestamp())`;
  return userId;
}

/**
 * @param auth          خدمة الاعتماد
 * @param sessionUserId صاحب الجلسة
 * @param company       الشركة والنشاط
 * @returns الجلسة الشخصية والـ cookie بتاعها
 */
export async function issueSession(
  auth: AuthService,
  sessionUserId: string,
  company: { companyId: string; businessId: string },
): Promise<StaffSession> {
  const issued = await auth.personal.issue(
    sessionUserId,
    { purpose: 'STAFF_PERSONAL', companyId: company.companyId, businessId: company.businessId },
    async () => true,
  );
  const cookie = issued.cookie.split(';')[0] ?? '';
  return {
    userId: sessionUserId,
    companyId: company.companyId,
    cookie,
    headers: { cookie, origin: personalOrigin },
  };
}

/**
 * @param seed   اتصال المالك ومولّد المعرفات
 * @param auth   خدمة الاعتماد
 * @param userId صاحب الجلسة
 * @param company الشركة والنشاط والفرع
 * @returns الـ cookie بتاع جلسة الكشك
 */
export async function receptionCookie(
  seed: SeedContext,
  auth: AuthService,
  userId: string,
  company: CompanyRows,
): Promise<string> {
  const kiosk = await auth.staff.issue(
    userId,
    {
      companyId: company.companyId,
      businessId: company.businessId,
      branchId: company.branchId,
      deviceId: seed.ids.newId(),
    },
    async () => true,
  );
  return kiosk.cookie.split(';')[0] ?? '';
}

/**
 * @param app  التطبيق
 * @param auth خدمة الاعتماد
 * @returns الـ cookie بتاع جلسة الإدارة
 */
export async function adminCookie(
  app: NestFastifyApplication,
  auth: AuthService,
): Promise<string> {
  const email = 'push-admin@example.test';
  const password = 'synthetic-admin-password';
  await auth.provisionUser({ email, name: 'Synthetic admin', password });
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/sign-in/email',
    headers: { origin: adminOrigin },
    payload: { email, password },
  });
  const setCookie = response.headers['set-cookie'];
  return (Array.isArray(setCookie) ? setCookie : [setCookie ?? ''])
    .map((value) => value.split(';')[0])
    .join('; ');
}
