import { SYSTEM_ROLES, createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { Writable } from 'node:stream';
import {
  createCancelPendingStaffAccessSteps,
  createStaffAccessCancelUser,
} from '../src/modules/staff/persistence/staff-access-auth.adapter.ts';
import { CancelPendingStaffAccessUseCase } from '../src/modules/staff/use-cases/cancel-pending-staff-access/cancel-pending-staff-access.ts';
import { GrantEmployeeAccessUseCase } from '../src/modules/staff/use-cases/grant-employee-access/grant-employee-access.ts';
import { startHarness, type Harness } from './harness.ts';
import { captureServerFaults, recordSwallowedFault } from './server-faults.ts';
import {
  STAFF_PIN_USE_CASES,
  type StaffPinUseCases,
} from '../src/modules/identity/http/staff-pin.controller.ts';

const ids = systemUuidV7();
const logLines: string[] = [];
const sink = new Writable({
  write(chunk, _encoding, done) {
    logLines.push(String(chunk));
    done();
  },
});
/** سجل API المحجوب عن stdout لفحص عدم تسريب الهاتف أو الرقم السري. */
export const capturedLogs = () => logLines.join('\n');

/** دوال النظام بمعرّفاتها الثابتة لإنشاء عضوية مدير فرع حقيقية. */
export const systemRoleId = (code: string): string => {
  const role = SYSTEM_ROLES.find((candidate) => candidate.code === code);
  if (role === undefined) throw new Error(`missing system role ${code}`);
  return role.id;
};

export interface StaffAccessFixture {
  readonly h: Harness;
  readonly ownerCookie: string;
  readonly company: string;
  readonly business: string;
  readonly salmiya: string;
  readonly hawalli: string;
  /** الموظفة على فرع السالمية. */
  readonly sara: string;
  /** الموظفة على فرع حولي. */
  readonly nora: string;
  /** المستخدم الملزم بصف مدير الفرع (من signedInOperator). */
  readonly managerUserId: string;
  readonly managerCookie: string;
  readonly db: ReturnType<typeof createDatabase>;
  readonly phoneCounter: { n: number };
}

/**
 * شركة واحدة بنشاط وفرعين (السالمية وحولي) وموظفتين، وشركة ثانية للعزل.
 * المالك افتراضياً يملك `manage:staff-access:branch` من بذرة 0252، ومدير الفرع كذلك بدوره النظامي.
 */
export async function staffAccessFixture(
  options: Parameters<typeof startHarness>[0] = {},
): Promise<StaffAccessFixture> {
  captureServerFaults();
  const h = await startHarness({ ...options, logs: sink });
  if (options.staffAccessRoutes) observeGrantFailures(h);
  if (options.staffOrigin !== undefined) observeSwallowedPinFailures(h);
  const onboardOrThrow = async (cookie: string, name: string) => {
    const res = await h.send('POST', '/v1/companies', {
      cookie,
      key: `onboard-${name.replaceAll(' ', '-')}`,
      body: { name_en: name, plan_id: (await import('@pospay/db')).PROVISIONAL_PLAN_ID },
    });
    if (res.status !== 201) {
      throw new Error(`onboarding failed with ${res.status}`);
    }
    return res.body['id'] as string;
  };
  const ownerCookie = await h.signedInOperator('staff-access-owner@example.test');
  const managerCookie = await h.signedInOperator('staff-access-manager@example.test');
  const company = await onboardOrThrow(ownerCookie, 'Staff access employer');
  const [managerUser] =
    await h.owner`SELECT id FROM "user" WHERE email='staff-access-manager@example.test'`;
  const managerUserId = managerUser?.['id'] as string;
  const business = ids.newId();
  await h.owner`INSERT INTO businesses (company_id,id,name_en,vertical_type)
    VALUES (${company},${business},'Staff access business','salon')`;
  const salmiya = ids.newId();
  const hawalli = ids.newId();
  for (const branch of [salmiya, hawalli]) {
    await h.owner`INSERT INTO branches (company_id,id,business_id,name_en)
      VALUES (${company},${branch},${business},'Synthetic branch')`;
  }
  // مدير فرع السالمية بدوره النظامي ونطاق فرعها — حائز افتراضي للصلاحية من 0252.
  const managerMembership = ids.newId();
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${company},${managerMembership},${managerUserId},${systemRoleId('branch_manager')},'global','BRANCH',${salmiya})`;
  const db = createDatabase({ url: h.urls.app, ids });
  return {
    h,
    ownerCookie,
    company,
    business,
    salmiya,
    hawalli,
    sara: salmiya,
    nora: hawalli,
    managerUserId,
    managerCookie,
    db,
    phoneCounter: { n: 100 },
  };
}

export type Fixture = StaffAccessFixture;

/** موظفة جديدة على فرع داخل الشركة — كل اختبار يصنع موظفاته الخاصة حتى لا تتداخل الحالات. */
export const addEmployee = async (
  f: Fixture,
  name: string,
  branchId: string,
  employeeNumber: number,
): Promise<string> => {
  const employeeId = ids.newId();
  await f.h
    .owner`INSERT INTO employees (company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES (${f.company},${employeeId},${f.business},${branchId},${name},${name.toLowerCase()},'staff','2026-01-01',${employeeNumber})`;
  await f.h
    .owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES (${f.company},${ids.newId()},${f.business},${employeeId},${branchId},'2026-01-01')`;
  return employeeId;
};

/** هاتف كانوني جديد لكل نداء. */
export const nextPhone = (f: Fixture) => {
  f.phoneCounter.n += 1;
  return `+96551234${String(f.phoneCounter.n).padStart(2, '0')}`;
};

export const grantPath = (f: Fixture, employeeId: string) =>
  `/v1/businesses/${f.business}/employees/${employeeId}/staff-access`;

export const grant = (
  f: Fixture,
  employeeId: string,
  phone: string,
  cookie = f.ownerCookie,
  body: Record<string, unknown> = {},
) =>
  f.h
    .send('POST', grantPath(f, employeeId), {
      cookie,
      company: f.company,
      body: { phone, phone_confirmed: true, role: 'staff', pin: '1234', ...body },
    });

export const readState = (f: Fixture, employeeId: string, cookie = f.ownerCookie) =>
  f.h.send('GET', grantPath(f, employeeId), { cookie, company: f.company });

export const cancelPending = (f: Fixture, employeeId: string, cookie = f.ownerCookie) =>
  f.h.send('DELETE', `${grantPath(f, employeeId)}/pending`, { cookie, company: f.company });

/**
 * إلغاء بالـ use case مباشرة وبساعة محقونة — الاختبار يتحكم في «الآن» بدل تعديل صفوف الجدول،
 * فيثبت أن قاعدة الـ 24 ساعة تُقاس من بداية المحاولة الحالية.
 */
export async function cancelPendingAt(
  f: Fixture,
  employeeId: string,
  now: Date,
  cookie = f.ownerCookie,
): Promise<void> {
  const actor = await f.h.auth.getSession(new Headers({ cookie }));
  if (actor === null) throw new Error('ACTOR_MISSING');
  await new CancelPendingStaffAccessUseCase(
    createCancelPendingStaffAccessSteps(f.db),
    createStaffAccessCancelUser(f.h.auth.staffUsers),
    { now: () => now },
    ids,
  ).execute({
    companyId: f.company,
    userId: actor.userId,
    businessId: f.business,
    employeeId,
  });
}

/** صفوف تدقيق الشركة الخاصة بموظفة، بلا أي هاتف كامل داخلها. */
export const auditRows = async (f: Fixture, employeeId: string) =>
  f.h.owner`SELECT entity, entity_id, action, before, after FROM audit_log
    WHERE entity_id = ${employeeId} OR (after->>'employee_id' = ${employeeId}) ORDER BY action`;

/** مستخدمو الدخول المُنشأون في قاعدة الهوية. */
export const staffUsersOf = async (f: Fixture) =>
  f.h.owner`SELECT id, email, staff_access_operation_id, staff_access_company_id, phone_number,
    phone_binding_approved_at FROM "user" WHERE staff_access_company_id = ${f.company}`;

/** تسجيل الدخول بالرقم السري يبتلع سبب فشله ويرد 503؛ نلتقط السبب هنا للتشخيص فقط. */
function observeSwallowedPinFailures(h: Harness): void {
  const pins = h.app.get<StaffPinUseCases>(STAFF_PIN_USE_CASES);
  const execute = pins.signIn.execute.bind(pins.signIn);
  pins.signIn.execute = async (input) => {
    try {
      return await execute(input);
    } catch (error) {
      recordSwallowedFault(error, 503);
      throw error;
    }
  };
}

function observeGrantFailures(h: Harness): void {
  const useCase = h.app.get(GrantEmployeeAccessUseCase);
  const execute = useCase.execute.bind(useCase);
  useCase.execute = async (command) => {
    try {
      return await execute(command);
    } catch (error) {
      const code =
        error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : '[withheld]';
      const cause = error instanceof Error && 'cause' in error ? error.cause : error;
      const dbCode =
        typeof cause === 'object' && cause !== null && 'code' in cause &&
        typeof cause.code === 'string' && /^[A-Z0-9_]+$/.test(cause.code) ? cause.code : '';
      console.log('STAFF_ACCESS_DIAGNOSTIC', code, dbCode);
      throw error;
    }
  };
}

export { hashStaffPin } from '../src/modules/identity/index.ts';
