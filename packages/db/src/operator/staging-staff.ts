import { sql } from 'drizzle-orm';

import { SYSTEM_ROLES } from '../access-catalog.ts';
import { appendAuditLog } from '../audit-log.ts';
import { createDatabase } from '../client.ts';
import type { IdGenerator, Tx } from '../with-tenant.ts';

export type StagingStaffRefusalCode =
  | 'TARGET_SCOPE_REFUSED'
  | 'EMPLOYEE_NOT_FOUND'
  | 'EMPLOYEE_LINKED_TO_ANOTHER_USER'
  | 'NO_ACTIVE_MEMBERSHIP'
  | 'USER_ALREADY_LINKED_IN_BUSINESS';

/**
 * رفض متوقع من استثناء PP-58.3 التشغيلي المخصص لـ staging؛ الكود ثابت وآمن للطباعة بلا تفاصيل قاعدة البيانات.
 * هذه المساعدات ليست في المدخل العام، لأن ADR-0003 يسمح بتغيير العضويات عبر identity use cases فقط.
 */
export class StagingStaffRefusal extends Error {
  override readonly name = 'StagingStaffRefusal';
  readonly code: StagingStaffRefusalCode;

  constructor(code: StagingStaffRefusalCode) {
    super(code);
    this.code = code;
  }
}

type OperatorInput = {
  appUrl: string;
  ids: IdGenerator;
  companyId: string;
  userId: string;
  operator: string;
};

const staffRoleId = (): string => {
  const role = SYSTEM_ROLES.find((candidate) => candidate.code === 'staff');
  if (role === undefined) throw new StagingStaffRefusal('TARGET_SCOPE_REFUSED');
  return role.id;
};

function refuse(code: StagingStaffRefusalCode): never {
  throw new StagingStaffRefusal(code);
}

async function withOperatorDatabase<T>(
  input: OperatorInput,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  const database = createDatabase({ url: input.appUrl, ids: input.ids });
  try {
    await database.ping();
    return await database.withTenant(input.companyId, work);
  } finally {
    await database.close();
  }
}

async function lockScope(
  tx: Tx,
  input: OperatorInput & { businessId: string; branchId: string },
): Promise<void> {
  const company = await tx.execute(
    sql`SELECT id FROM companies WHERE id=${input.companyId} AND deleted_at IS NULL FOR NO KEY UPDATE`,
  );
  if (company.length !== 1) refuse('TARGET_SCOPE_REFUSED');
  const [scope] = await tx.execute<{ business_ok: boolean; branch_ok: boolean }>(sql`
    SELECT EXISTS(SELECT 1 FROM businesses WHERE company_id=${input.companyId} AND id=${input.businessId}) AS business_ok,
      EXISTS(SELECT 1 FROM branches WHERE company_id=${input.companyId} AND id=${input.branchId}
        AND business_id=${input.businessId}) AS branch_ok`);
  if (scope?.business_ok !== true || scope.branch_ok !== true) refuse('TARGET_SCOPE_REFUSED');
}

/**
 * ينشئ عضوية staff لفرع واحد لمستخدم اختبار staging، مع قفل الشركة وتدقيق بلا actor مستخدم.
 * استثناء PP-58.3 التشغيلي محفوظ خارج المدخل العام حتى لا يتجاوز أحد مسار identity المطلوب في ADR-0003.
 *
 * @param input اتصال pospay_app ومعرفات الشركة والنشاط والفرع والمستخدم واسم الـ operator
 * @returns created عند الإدراج مع التدقيق، أو unchanged عند وجود العضوية السارية نفسها
 */
export async function ensureStaffBranchMembership(input: {
  appUrl: string;
  ids: IdGenerator;
  companyId: string;
  businessId: string;
  branchId: string;
  userId: string;
  operator: string;
}): Promise<'created' | 'unchanged'> {
  return withOperatorDatabase(input, async (tx) => {
    await lockScope(tx, input);
    const existing = await tx.execute(sql`SELECT id FROM memberships
      WHERE company_id=${input.companyId} AND user_id=${input.userId}
        AND role_id=${staffRoleId()} AND role_owner_key='global' AND scope_type='BRANCH' AND scope_id=${input.branchId}
        AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now()) LIMIT 1`);
    if (existing.length === 1) return 'unchanged';
    const membershipId = input.ids.newId();
    await tx.execute(sql`INSERT INTO memberships
      (company_id,id,user_id,employee_id,role_id,role_owner_key,scope_type,scope_id,ends_at)
      VALUES (${input.companyId},${membershipId},${input.userId},NULL,${staffRoleId()},'global','BRANCH',${input.branchId},NULL)`);
    await appendAuditLog(tx, input.ids.newId(), {
      entity: 'membership',
      entityId: membershipId,
      action: 'role.granted',
      after: {
        operator: input.operator,
        membership_id: membershipId,
        user_id: input.userId,
        role_id: staffRoleId(),
        scope_id: input.branchId,
      },
    });
    return 'created';
  });
}

async function checkEmployeeLink(
  tx: Tx,
  input: OperatorInput & { businessId: string; employeeId: string },
  employee: { user_id: string | null },
): Promise<void> {
  if (employee.user_id !== null) refuse('EMPLOYEE_LINKED_TO_ANOTHER_USER');
  const [membership] = await tx.execute<{ active: boolean }>(sql`
    SELECT EXISTS(SELECT 1 FROM memberships WHERE company_id=${input.companyId} AND user_id=${input.userId}
      AND starts_at <= statement_timestamp()
      AND (ends_at IS NULL OR ends_at > statement_timestamp())) AS active`);
  if (membership?.active !== true) refuse('NO_ACTIVE_MEMBERSHIP');
  const duplicate = await tx.execute(sql`SELECT id FROM employees
    WHERE company_id=${input.companyId} AND business_id=${input.businessId} AND user_id=${input.userId}
      AND id<>${input.employeeId} AND deleted_at IS NULL LIMIT 1`);
  if (duplicate.length !== 0) refuse('USER_ALREADY_LINKED_IN_BUSINESS');
}

/**
 * يربط موظف staging بهوية مستخدمه بعد إثبات عضوية سارية، ويحافظ على قاعدة مستخدم واحد داخل النشاط.
 * استثناء PP-58.3 لا يُصدَّر من المدخل العام؛ يظل تغيير الإنتاج الاعتيادي داخل identity/staff use cases وفق ADR-0003.
 *
 * @param input اتصال pospay_app ومعرفات الشركة والنشاط والموظف والمستخدم واسم الـ operator
 * @returns linked بعد التحديث والتدقيق، أو unchanged عندما يكون الربط المطلوب موجوداً
 */
export async function ensureEmployeeUserLink(input: {
  appUrl: string;
  ids: IdGenerator;
  companyId: string;
  businessId: string;
  employeeId: string;
  userId: string;
  operator: string;
}): Promise<'linked' | 'unchanged'> {
  return withOperatorDatabase(input, async (tx) => {
    const [before] = await tx.execute<{ user_id: string | null }>(sql`
      SELECT user_id FROM employees WHERE company_id=${input.companyId} AND business_id=${input.businessId}
        AND id=${input.employeeId} AND deleted_at IS NULL FOR UPDATE`);
    if (before === undefined) refuse('EMPLOYEE_NOT_FOUND');
    if (before.user_id === input.userId) return 'unchanged';
    await checkEmployeeLink(tx, input, before);
    await tx.execute(sql`UPDATE employees SET user_id=${input.userId},revision=revision+1
      WHERE company_id=${input.companyId} AND business_id=${input.businessId} AND id=${input.employeeId}
        AND deleted_at IS NULL`);
    await appendAuditLog(tx, input.ids.newId(), {
      entity: 'employee',
      entityId: input.employeeId,
      action: 'updated',
      after: { operator: input.operator, employee_id: input.employeeId, user_id: input.userId },
    });
    return 'linked';
  });
}
