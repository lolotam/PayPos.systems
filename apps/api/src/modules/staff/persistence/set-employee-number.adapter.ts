import {
  appendAuditLog,
  currentAttachment,
  lockEmployeeNumberCounter,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';
import { lockEmployeeNumberAccess, readEmployeeNumberAccess } from '../../identity/index.ts';
import { type EmployeeNumberAudit } from '../domain/employee-number-change.ts';
import { SetEmployeeNumberError } from '../domain/errors.ts';
import type {
  SetEmployeeNumberActor,
  SetEmployeeNumberScope,
  SetEmployeeNumberTransactions,
} from '../ports/employee-number.port.ts';

const NUMBER_KEY = 'employees_company_employee_number_key';

export function createSetEmployeeNumberTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
): SetEmployeeNumberTransactions {
  return {
    run: (actor, work) =>
      database
        .withTenant(actor.companyId, (tx) => work(numberScope(tx, actor, ids)), { userId: actor.userId })
        .catch((error: unknown) => {
          throw mapped(error);
        }),
  };
}

function numberScope(tx: Tx, actor: SetEmployeeNumberActor, ids: IdGenerator): SetEmployeeNumberScope {
  return {
    lockAccess: () => lockEmployeeNumberAccess(tx, actor.companyId),
    readEmployee: (businessId, employeeId) => readEmployee(tx, actor.companyId, businessId, employeeId),
    recheck: (businessId, branchIds) =>
      readEmployeeNumberAccess(tx, actor.companyId, actor.userId, businessId, branchIds),
    lockCounter: async () => {
      // التعديل اليدوي يقفل العدّاد حتى لا يتسابق مع الإسناد التلقائي، ولا يحرّكه (FR-003).
      await lockEmployeeNumberCounter(tx, actor.companyId);
    },
    lockEmployee: (businessId, employeeId) => lockEmployee(tx, actor.companyId, businessId, employeeId),
    taken: (employeeId, employeeNumber) => taken(tx, actor.companyId, employeeId, employeeNumber),
    save: (employeeId, change) => save(tx, actor.companyId, ids, employeeId, change),
  };
}

async function readEmployee(tx: Tx, companyId: string, businessId: string, employeeId: string) {
  // نشاط مختلف أو حذف ناعم يبدوان غياباً حتى لا يكشف المسار وجود الصف (D-5).
  const [row] = await tx.execute<{
    business_id: string;
    primary_branch_id: string;
    employee_number: number | string | null;
  }>(sql`SELECT business_id, primary_branch_id, employee_number FROM employees
    WHERE company_id=${companyId} AND id=${employeeId} AND business_id=${businessId} AND deleted_at IS NULL`);
  if (row === undefined) return null;
  return {
    business_id: row.business_id,
    primary_branch_id: row.primary_branch_id,
    employee_number: storedNumber(row.employee_number),
    attached_branch_ids: await currentBranchIds(tx, companyId, employeeId),
  };
}

async function lockEmployee(tx: Tx, companyId: string, businessId: string, employeeId: string) {
  const [row] = await tx.execute<{
    primary_branch_id: string;
    employee_number: number | string | null;
  }>(sql`
    SELECT primary_branch_id, employee_number FROM employees
    WHERE company_id=${companyId} AND id=${employeeId} AND business_id=${businessId} AND deleted_at IS NULL
    FOR NO KEY UPDATE`);
  if (row === undefined) return null;
  return {
    primary_branch_id: row.primary_branch_id,
    employee_number: storedNumber(row.employee_number),
    attached_branch_ids: await currentBranchIds(tx, companyId, employeeId),
  };
}

async function currentBranchIds(tx: Tx, companyId: string, employeeId: string) {
  const attached = await tx.execute<{ branch_id: string }>(sql`
    SELECT eb.branch_id FROM employee_branches eb
    WHERE eb.company_id=${companyId} AND eb.employee_id=${employeeId} AND ${currentAttachment()}`);
  return attached.map((link) => link.branch_id);
}

export function refuseTypedEmployeeNumber(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  primaryBranchId: string,
) {
  // الإنشاء يفحص النشاط والفرع الأساسي فقط؛ تاريخ بداية الارتباط لا يُخرج الفرع من المنع (PP-4.2).
  return readEmployeeNumberAccess(tx, companyId, userId, businessId, [primaryBranchId]);
}

export async function typedEmployeeNumberTaken(tx: Tx, companyId: string, employeeNumber: number) {
  // الرقم المحذوف ناعماً يبقى محجوزاً للشركة، ولا يُستثنى صف لأن الموظفة لم تُنشأ بعد (EN-Q4).
  const [row] = await tx.execute<{ id: string }>(sql`
    SELECT id FROM employees
    WHERE company_id=${companyId} AND employee_number=${employeeNumber}
    LIMIT 1`);
  return row !== undefined;
}

async function taken(tx: Tx, companyId: string, employeeId: string, employeeNumber: number) {
  // الرقم المحذوف ناعماً يبقى محجوزاً للشركة (EN-Q4).
  const [row] = await tx.execute<{ id: string }>(sql`
    SELECT id FROM employees
    WHERE company_id=${companyId} AND employee_number=${employeeNumber} AND id<>${employeeId}
    LIMIT 1`);
  return row !== undefined;
}

async function save(
  tx: Tx,
  companyId: string,
  ids: IdGenerator,
  employeeId: string,
  change: EmployeeNumberAudit,
) {
  await tx.execute(sql`
    UPDATE employees SET employee_number=${change.after.employee_number}
    WHERE company_id=${companyId} AND id=${employeeId} AND deleted_at IS NULL`);
  await appendAuditLog(tx, ids.newId(), {
    entity: 'employees',
    entityId: employeeId,
    action: 'employee_number.changed',
    before: change.before,
    after: change.after,
  });
}

function storedNumber(value: number | string | null): number | null {
  if (value === null) return null;
  return typeof value === 'number' ? value : Number(value);
}

function mapped(error: unknown): never {
  const seen = new Set<unknown>();
  let code: string | undefined;
  let constraint: string | undefined;
  for (
    let current: unknown = error;
    typeof current === 'object' && current !== null && !seen.has(current);
    current = (current as { cause?: unknown }).cause
  ) {
    seen.add(current);
    if (current instanceof SetEmployeeNumberError) throw current;
    const node = current as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
    if (code === undefined && node.code !== undefined) code = String(node.code);
    const name = node.constraint_name ?? node.constraint;
    if (constraint === undefined && typeof name === 'string') constraint = name;
  }
  if (code === '23505' && constraint === NUMBER_KEY) throw new SetEmployeeNumberError('EMPLOYEE_NUMBER_TAKEN');
  if (code === '40001' || code === '40P01' || code === '55P03')
    throw new SetEmployeeNumberError('TRANSACTION_RETRY_REQUIRED');
  throw error;
}

// بداية الترقيم تعيد استخدام نفس رمزي identity حتى لا يظهر سهم قراءة جديد.
export function lockEmployeeNumberCompany(tx: Tx, companyId: string) {
  return lockEmployeeNumberAccess(tx, companyId);
}

export function recheckEmployeeNumberCompany(tx: Tx, companyId: string, userId: string) {
  return readEmployeeNumberAccess(tx, companyId, userId);
}
