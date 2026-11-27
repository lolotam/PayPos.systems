import type { IdGenerator, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { grantStaffMembership, staffAccessGrantedEvent } from '../../identity/index.ts';
import { attendanceBranch, businessTimeZone } from '../../tenancy/index.ts';
import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';
import type { OutboxWriter } from '../../../shared/ports/outbox-writer.port.ts';
import type { StaffAccessBranchAssignment } from '../domain/staff-access.ts';
import type { StaffAccessRole } from '../ports/staff-access-begin.port.ts';
import type { AuthFacadeForStaffAccess } from '../ports/staff-access-auth.port.ts';
import { lockExtraBranchRows, readExtraBranchRows } from './staff-access-rows.ts';

/** بيانات السجل والموظفة اللي الفروع الإضافية بتكتب عليها. */
export interface ExtraBranchContext {
  /** الشركة. */
  readonly companyId: string;
  /** المانح من الجلسة — بيتكتب في حدث المنح. */
  readonly actorUserId: string;
  /** نشاط الموظفة. */
  readonly businessId: string;
  /** الموظفة. */
  readonly employeeId: string;
  /** سجل الدخول. */
  readonly recordId: string;
  /** مولّد المعرّفات. */
  readonly ids: IdGenerator;
  /** لحظة المعاملة. */
  readonly at: Date;
}

/**
 * يقرأ الفروع الإضافية المحفوظة للسجل كإسنادات دومين (080-b) — المقارنة مع الطلب بتتم عليها.
 *
 * @param tx        معاملة الشركة
 * @param companyId الشركة
 * @param recordId  سجل الدخول
 * @returns الفروع الإضافية المحفوظة
 */
export async function readExtraBranches(
  tx: Tx,
  companyId: string,
  recordId: string,
): Promise<readonly StaffAccessBranchAssignment[]> {
  const rows = await readExtraBranchRows(tx, companyId, recordId);
  return rows.map((row) => ({ branchId: row.branch_id, role: row.role_code }));
}

/**
 * يكتب صفوف الفروع الإضافية الجديدة مع تدقيق الإنشاء (080-b) — العضوية بتتفضل NULL لحد التفعيل.
 *
 * @param tx      معاملة الشركة
 * @param context السجل والموظفة
 * @param extras  الفروع الإضافية الجديدة
 */
export async function insertExtraBranches(
  tx: Tx,
  context: ExtraBranchContext,
  extras: readonly StaffAccessBranchAssignment[],
): Promise<void> {
  if (extras.length === 0) return;
  const audit = transactionWriters(tx, context.ids).audit;
  for (const extra of extras) {
    const id = context.ids.newId();
    await tx.execute(sql`INSERT INTO employee_staff_access_branches
      (company_id,id,business_id,employee_id,access_id,branch_id,role_code,membership_id)
      VALUES (${context.companyId},${id},${context.businessId},${context.employeeId},${context.recordId},
        ${extra.branchId},${extra.role},NULL)`);
    await audit.record({
      entity: 'employee_staff_access_branch',
      entityId: id,
      action: 'created',
      after: {
        access_id: context.recordId,
        employee_id: context.employeeId,
        branch_id: extra.branchId,
        role_code: extra.role,
        state: 'PENDING',
      },
    });
  }
}

/**
 * يستبدل صفوف الفروع الإضافية القديمة بالجديدة (080-b): الصفوف القديمة بتتقفل وبتتشال وبتتدقيق
 * قبل كتابة الجديدة، فما يبقاش فرع زيادة قديم ولا عضوية معلّقة.
 *
 * @param tx      معاملة الشركة
 * @param context السجل والموظفة
 * @param extras  الفروع الإضافية الجديدة
 */
export async function replaceExtraBranches(
  tx: Tx,
  context: ExtraBranchContext,
  extras: readonly StaffAccessBranchAssignment[],
): Promise<void> {
  const audit = transactionWriters(tx, context.ids).audit;
  const previous = await lockExtraBranchRows(tx, context.companyId, context.recordId);
  for (const row of previous) {
    await tx.execute(
      sql`DELETE FROM employee_staff_access_branches
      WHERE company_id=${context.companyId} AND id=${row.id}`,
    );
    await audit.record({
      entity: 'employee_staff_access_branch',
      entityId: row.id,
      action: 'removed',
      before: { branch_id: row.branch_id, role_code: row.role_code },
      after: { access_id: context.recordId, employee_id: context.employeeId },
    });
  }
  await insertExtraBranches(tx, context, extras);
}

/**
 * يمنح عضوية لكل فرع إضافي (080-b): عضوية بدور الفرع وربط الصف بها ومزامنة ارتباط الموظفة بالفرع
 * وحدث `StaffAccessGranted` — كله في نفس معاملة الخطوة الثالثة.
 *
 * @param tx      معاملة الشركة
 * @param auth    واجهة حساب الموظفة عبر identity
 * @param context السجل والموظفة
 * @param payload المستخدم ومعرّف العملية والفروع المقفولة
 * @returns العضويات الممنوحة مع فرعها ودورها
 */
export async function grantExtraBranchMemberships(
  tx: Tx,
  auth: AuthFacadeForStaffAccess,
  context: ExtraBranchContext,
  payload: {
    readonly operationId: string;
    readonly userId: string;
    readonly branches: readonly {
      readonly id: string;
      readonly branchId: string;
      readonly roleCode: StaffAccessRole;
    }[];
  },
): Promise<readonly { membershipId: string; branchId: string; role: StaffAccessRole }[]> {
  const granted: { membershipId: string; branchId: string; role: StaffAccessRole }[] = [];
  for (const extra of payload.branches)
    granted.push(await grantOneExtraBranch(tx, auth, context, payload, extra));
  return granted;
}

/** عضوية فرع إضافي واحد: العضوية نفسها وربط الصف بها ومزامنة الفرع والحدث. */
async function grantOneExtraBranch(
  tx: Tx,
  auth: AuthFacadeForStaffAccess,
  context: ExtraBranchContext,
  payload: {
    readonly operationId: string;
    readonly userId: string;
  },
  extra: { readonly id: string; readonly branchId: string; readonly roleCode: StaffAccessRole },
): Promise<{ membershipId: string; branchId: string; role: StaffAccessRole }> {
  const writers = transactionWriters(tx, context.ids);
  const membership = await grantStaffMembership(tx, auth, {
    operationId: payload.operationId,
    companyId: context.companyId,
    userId: payload.userId,
    branchId: extra.branchId,
    role: extra.roleCode,
    ids: context.ids,
  });
  await writers.audit.record({
    entity: 'membership',
    entityId: membership.membershipId,
    action: 'created',
    after: {
      user_id: payload.userId,
      scope_type: 'BRANCH',
      scope_id: extra.branchId,
      role: extra.roleCode,
    },
  });
  await activateExtraBranch(tx, context, extra, membership.membershipId, writers.audit);
  await attachEmployeeBranch(tx, context, extra.branchId, writers.audit);
  await appendGrantedEvent(
    writers.outbox,
    {
      employeeId: context.employeeId,
      userId: payload.userId,
      membershipId: membership.membershipId,
      branchId: extra.branchId,
      role: extra.roleCode,
    },
    { actorUserId: context.actorUserId, at: context.at },
  );
  return {
    membershipId: membership.membershipId,
    branchId: extra.branchId,
    role: extra.roleCode,
  };
}

/** يربط صف الفرع الإضافي بالعضوية الممنوحة ويكتب تدقيق التفعيل. */
async function activateExtraBranch(
  tx: Tx,
  context: ExtraBranchContext,
  extra: { readonly id: string; readonly branchId: string; readonly roleCode: StaffAccessRole },
  membershipId: string,
  audit: AuditTrail,
): Promise<void> {
  await tx.execute(sql`UPDATE employee_staff_access_branches SET membership_id=${membershipId}
    WHERE company_id=${context.companyId} AND id=${extra.id}`);
  await audit.record({
    entity: 'employee_staff_access_branch',
    entityId: extra.id,
    action: 'activated',
    after: {
      access_id: context.recordId,
      employee_id: context.employeeId,
      branch_id: extra.branchId,
      role_code: extra.roleCode,
      membership_id: membershipId,
    },
  });
}

/**
 * يزامن ارتباط الموظفة بالفرع الإضافي (080-b): بداية الارتباط هي تاريخ المنح في توقيت الفرع،
 * مش تاريخ التعيين. لو فيه ارتباط ساري يغطي نفس اليوم ما بيتكتبش صف تاني.
 *
 * @param tx       معاملة الشركة
 * @param context  السجل والموظفة
 * @param branchId الفرع الإضافي
 * @param audit    مسار التدقيق
 */
async function attachEmployeeBranch(
  tx: Tx,
  context: ExtraBranchContext,
  branchId: string,
  audit: AuditTrail,
): Promise<void> {
  const grantDate = await grantDateInBranchTimeZone(tx, context, branchId);
  const covering = await tx.execute(sql`SELECT 1 FROM employee_branches
    WHERE company_id=${context.companyId} AND employee_id=${context.employeeId} AND branch_id=${branchId}
      AND "from"<=${grantDate}::date AND ("to" IS NULL OR "to">${grantDate}::date)
    LIMIT 1 FOR UPDATE`);
  if (covering.length !== 0) return;
  const [future] = await tx.execute<{ next_from: string }>(sql`
    SELECT to_char("from",'YYYY-MM-DD') AS next_from FROM employee_branches
    WHERE company_id=${context.companyId} AND employee_id=${context.employeeId} AND branch_id=${branchId}
      AND "from">${grantDate}::date
    ORDER BY "from" ASC LIMIT 1 FOR UPDATE`);
  const toDate = future?.next_from ?? null;
  const attachmentId = context.ids.newId();
  await tx.execute(sql`INSERT INTO employee_branches
    (company_id,id,business_id,employee_id,branch_id,"from","to")
    VALUES (${context.companyId},${attachmentId},${context.businessId},${context.employeeId},${branchId},
      ${grantDate}::date,${toDate}::date)`);
  await audit.record({
    entity: 'employee_branch',
    entityId: attachmentId,
    action: 'created',
    after: {
      employee_id: context.employeeId,
      branch_id: branchId,
      from: grantDate,
      ...(toDate === null ? {} : { to: toDate }),
      source: 'staff_access_grant',
    },
  });
}

/**
 * تاريخ المنح في توقيت الفرع (080-b): تاريخ اليوم في توقيت الفرع، ومنه توقيت النشاط لو
 * الفرع مالوش توقيت، و'Asia/Kuwait' لو النشاط كمان مالوش توقيت.
 */
async function grantDateInBranchTimeZone(
  tx: Tx,
  context: ExtraBranchContext,
  branchId: string,
): Promise<string> {
  const branch = await attendanceBranch(tx, context.companyId, context.businessId, branchId);
  const timeZone =
    branch?.timezone ?? (await businessTimeZone(tx, context.companyId, context.businessId)) ?? 'Asia/Kuwait';
  const [row] = await tx.execute<{ grant_date: string }>(sql`
    SELECT (${context.at.toISOString()}::timestamptz AT TIME ZONE ${timeZone})::date::text AS grant_date`);
  if (row === undefined) throw new Error('STAFF_ACCESS_GRANT_DATE_MISSING');
  return row.grant_date;
}

/** يكتب حدث `StaffAccessGranted` لعضوية الفرع الإضافي — بلا هاتف ولا رقم سري في الحمولة. */
async function appendGrantedEvent(
  outbox: OutboxWriter,
  payload: {
    employeeId: string;
    userId: string;
    membershipId: string;
    branchId: string;
    role: StaffAccessRole;
  },
  stamp: { actorUserId: string; at: Date },
): Promise<void> {
  const built = staffAccessGrantedEvent({
    employee_id: payload.employeeId,
    user_id: payload.userId,
    membership_id: payload.membershipId,
    branch_id: payload.branchId,
    role: payload.role,
    actor_user_id: stamp.actorUserId,
    occurred_at: stamp.at.toISOString(),
  });
  await outbox.append({
    aggregateType: built.aggregateType,
    aggregateId: payload.employeeId,
    eventType: built.eventType,
    payload: built.payload,
  });
}
