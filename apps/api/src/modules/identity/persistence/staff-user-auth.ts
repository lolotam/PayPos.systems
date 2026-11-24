import { SYSTEM_ROLES, type IdGenerator, type Tx } from '@pospay/db';
import { hashCashierPin } from '@pospay/auth';
import { sql } from 'drizzle-orm';

import { isWellFormedCashierPin } from '../domain/cashier-pin.ts';
import { StaffUserRefused } from '../domain/staff-access-errors.ts';
import { staffAccessSystemRole, temporaryStaffPinExpiresAt } from '../domain/staff-access-roles.ts';
import type { StaffAccessRole } from '../domain/staff-access-roles.ts';
import type {
  StaffUserCancelInput,
  StaffUserFacade,
  StaffUserProvisionInput,
  StaffUserProvisioned,
  StaffUserRead,
} from '../ports/staff-users.port.ts';

/**
 * الخطوة الثانية من «إعطاء الدخول»: إنشاء مستخدم الموظفة أو إيجاده بمعرّف العملية على pospay_auth.
 * الاستدعاء الآمن الوحيد من staff لخطوة auth — identity هو مستورد packages/auth الوحيد (plan §2.1).
 *
 * @param auth  واجهة packages/auth على pospay_auth
 * @param input معرّف العملية والشركة والهاتف والاسم والمانح وحالة السجل ومولّد المعرّفات
 * @returns معرف المستخدم الموجود أو المُنشأ
 */
export async function provisionStaffUser(
  auth: StaffUserFacade,
  input: StaffUserProvisionInput,
): Promise<StaffUserProvisioned> {
  return auth.provision(input);
}

/**
 * حذف مستخدم الموظفة عند إلغاء سجل انتظار متجاوز — المسار الوحيد الذي يمسح هذا الحساب.
 *
 * @param auth  واجهة packages/auth على pospay_auth
 * @param input معرّف العملية والشركة
 */
export async function cancelStaffUser(
  auth: StaffUserFacade,
  input: StaffUserCancelInput,
): Promise<void> {
  return auth.cancel(input);
}

/**
 * قراءة مستخدم الموظفة بمعرّف العملية لعرض آخر ثلاثة أرقام من الهاتف في لوحة الموظفين.
 *
 * @param auth        واجهة packages/auth على pospay_auth
 * @param operationId معرّف العملية
 * @returns المعرف وآخر ثلاثة أرقام، أو null لما الحساب لسه متعملش
 */
export async function readStaffUser(
  auth: StaffUserFacade,
  operationId: string,
): Promise<StaffUserRead | null> {
  return auth.read(operationId);
}

/**
 * تصوير الرقم السري المؤقت قبل خطوة الكتابة — الـ hashing في packages/auth وحده (CLAUDE.md §8)
 * وidentity هي الجسر الوحيد بينه وبين staff.
 *
 * @param pin الرقم السري كما كتبه المانح (أربعة أرقام)
 * @returns الـ hash الذي يُخزن في cashier_pins ولا يُسجل في أي مكان
 */
export async function hashStaffPin(pin: string): Promise<string> {
  if (!isWellFormedCashierPin(pin)) throw new StaffUserRefused('STAFF_ACCESS_PIN_INVALID');
  return hashCashierPin(pin);
}

function systemRoleId(code: 'staff' | 'cashier'): string {
  const found = SYSTEM_ROLES.find((candidate) => candidate.code === code);
  if (found === undefined) throw new StaffUserRefused('STAFF_ACCESS_ROLE_MISSING');
  return found.id;
}

/**
 * يثبت أن المستخدم هو المقروض بمعرّف العملية وفي نفس الشركة عبر packages/auth (P1-5):
 * إثبات المنح الوحيد المقبول — لا صف وسيط ولا شركة أخرى ولا مستخدم آخر يقبل به.
 *
 * @param auth  واجهة packages/auth على pospay_auth
 * @param input الشركة والمستخدم ومعرّف العملية
 * @returns لا شيء عند تطابق الربط، ويرفض بـ StaffUserRefused عند أي عدم تطابق
 */
export async function assertStaffUserBinding(
  auth: StaffUserFacade,
  input: { companyId: string; userId: string; operationId: string },
): Promise<void> {
  const binding = await auth.bindingOf(input.operationId);
  if (binding === null || binding.userId !== input.userId || binding.companyId !== input.companyId)
    throw new StaffUserRefused('STAFF_ACCESS_USER_NOT_STAFF');
}

/**
 * يفتح عضوية الموظفة على فرعها الأساسي داخل معاملة staff نفسها (الاستثناء المحدود في ADR-0063).
 * الدور ييجي من جدول identity لا من الطلب، وقراءة auth تثبت الشركة ومعرّف العملية قبل كتابة العضوية.
 *
 * @param tx    معاملة الشركة التي فتحها use case الموظفين
 * @param auth قارئ الهوية لإثبات الشركة ومعرّف العملية
 * @param input الشركة والمستخدم والفرع ودور الطلب ومعرّفات جديدة للعضوية
 * @returns معرف العضوية المُنشأة
 */
export async function grantStaffMembership(
  tx: Tx,
  auth: StaffUserFacade,
  input: {
    companyId: string;
    userId: string;
    branchId: string;
    role: StaffAccessRole;
    operationId: string;
    ids: IdGenerator;
  },
): Promise<{ membershipId: string }> {
  await assertStaffUserBinding(auth, input);
  const membershipId = input.ids.newId();
  await tx.execute(sql`INSERT INTO memberships
    (company_id,id,user_id,employee_id,role_id,role_owner_key,scope_type,scope_id,ends_at)
    VALUES (${input.companyId},${membershipId},${input.userId},NULL,
      ${systemRoleId(staffAccessSystemRole(input.role))}::uuid,'global','BRANCH',${input.branchId},NULL)`);
  return { membershipId };
}

/**
 * حفظ الرقم السري كرقم مؤقت ينتهي بعد 24 ساعة (قرار D4): كل قراءة PIN قبل F2 ترفضه كرقم غلط،
 * والكتابة داخل معاملة staff المعاد استخدامها — التكرار بعد النجاح لا يعيد الكتابة أبداً.
 *
 * @param tx    معاملة الشركة التي فتحها use case الموظفين
 * @param input الشركة وصاحب الرقم والـ hash الجاهز والمانح ولحظة الضبط ومولّد المعرّفات
 */
export async function saveTemporaryStaffPin(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    pinHash: string;
    setBy: string;
    at: Date;
    ids: IdGenerator;
  },
): Promise<void> {
  const expiresAt = temporaryStaffPinExpiresAt(input.at);
  await tx.execute(
    sql`INSERT INTO cashier_pins(company_id,id,user_id,pin_hash,set_by,set_at,temporary,expires_at)
    VALUES(${input.companyId},${input.ids.newId()},${input.userId},${input.pinHash},${input.setBy},
      ${input.at.toISOString()}::timestamptz,true,${expiresAt.toISOString()}::timestamptz)
    ON CONFLICT(company_id,user_id) DO UPDATE SET id=EXCLUDED.id,pin_hash=EXCLUDED.pin_hash,
      set_by=EXCLUDED.set_by,set_at=EXCLUDED.set_at,temporary=true,expires_at=EXCLUDED.expires_at`,
  );
}
