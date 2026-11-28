import { firstFreeEmployeeNumber } from '@pospay/domain';
import { sql } from 'drizzle-orm';
import type postgres from 'postgres';

import type { DataStepApp } from './coverage.ts';
import type { Tx } from '../with-tenant.ts';

/** حجم الدفعة الافتراضي: أقصى عدد صفوف في معاملة واحدة. */
const DEFAULT_BATCH_SIZE = 500;

/** عدد محاولات الدفعة قبل الاستسلام: تصادم المفتاح الفريد ممكن، والدفعة ما بتتعلّقش للأبد. */
const MAX_BATCH_ATTEMPTS = 3;

/**
 * رفض ثابت النص لدور ترحيل بلا تجاوز للعزل: لا يحمل رابطاً ولا باسورد ولا بيانات.
 * بدون التجاوز، قراءة الشركات تحت FORCE RLS ترجع صفر صفوف، والخطوة كانت هتعدّي من غير ما ترقّم أحداً.
 */
export class EmployeeNumbersRoleRefusedError extends Error {
  readonly code = '42501';
  constructor() {
    super(
      'Migration data step employee-numbers needs a superuser or BYPASSRLS migration role; it would read no companies under FORCE RLS',
    );
  }
}

/**
 * رفض ثابت النص حين لا يتسع النطاق لكل موظفي شركة: يُفشل الخطوة فتبقى الـ migration معلّقة بدل أن تُسجَّل ناجحة
 * وفيها موظفون بلا رقم، ولا يحمل أي اسم أو رقم.
 */
export class EmployeeNumbersExhaustedError extends Error {
  readonly code = '23514';
  constructor() {
    super(
      'Migration data step employee-numbers could not number every employee: the 1..999999 range is full',
    );
  }
}

/** عدّادات خطوة الترقيم دون أي اسم أو رقم: الشركات والصفوف المقروءة والمرقّمة والتي لم يتسع لها النطاق. */
export interface EmployeeNumbersCounts {
  readonly companies: number;
  readonly read: number;
  readonly assigned: number;
  readonly exhausted: number;
}

/** رقم مخطط لصف واحد: معرّف الموظف والرقم الوظيفي المقترح. */
interface Assignment {
  readonly id: string;
  readonly n: number;
}

/** صف غيّره التحديث فعلاً: معرّف الموظف والرقم الوظيفي الذي كُتب. */
type AssignedRow = {
  readonly id: string;
  readonly employee_number: number;
};

/** خطة الدفعة: الصفوف التي لها رقم مقترح، والصفوف التي لم يتسع لها النطاق. */
interface BatchPlan {
  readonly assignments: readonly Assignment[];
  readonly exhausted: number;
}

/** نتيجة دفعة: ما قُرئ وما رُقّم وما لم يتسع له النطاق، وهل اكتملت الشركة. */
interface BatchCounts {
  readonly read: number;
  readonly assigned: number;
  readonly exhausted: number;
  readonly done: boolean;
}

/** علامة خاصة ترجع بها المحاولة عند سباق على صف سبق ترقيمه، حتى يتراجع الـ savepoint ويعيد قراءة الدفعة. */
const SKIPPED_ROW_ROLLBACK = Symbol('employeeNumbersSkippedRow');

/** نتيجة محاولة واحدة: إسناد ناجح، أو صف سبق ترقيمه في الدفعة، أو تصادم مفتاح فريد يستوجب إعادة القراءة والتخطيط. */
type BatchAttempt =
  | { readonly kind: 'assigned'; readonly rows: readonly AssignedRow[] }
  | { readonly kind: 'skipped' }
  | { readonly kind: 'conflict'; readonly error: unknown };

/**
 * يرقّم الموظفين الذين بلا رقم وظيفي داخل كل شركة بالترتيب: تاريخ التعيين ثم وقت الإنشاء ثم المعرف، والمحذوفون
 * منطقياً داخلون (قرارا المالك EN-Q1 وEN-Q7). كل شركة تعمل داخل withTenant على pospay_app، ويقفل صف العدّاد
 * قبل أي إسناد. لا تُعاد كتابة رقم موجود، فالإعادة آمنة. العدّاد لا يتحرك للخلف ولا يتأثر برقم كُتب بالإيد.
 * العدّاد يتحرك من الصفوف التي غُيّرت فعلاً فقط، فصفّ رقمته معاملة أخرى لا يستهلك رقماً من العدّاد، ولا يقطع
 * النطاق قبل أوانه. تصادم المفتاح الفريد بعد قراءة الأرقام المستخدمة يُعاد داخل savepoint، فتُقرأ الأرقام من
 * جديد وتُخطّط الدفعة على الصفوف التي ما زالت بلا رقم. الخطوة مبنية على ADR-0038؛ مالك الترحيل يقرأ معرفات
 * الشركات فقط.
 *
 * @param owner اتصال الترحيل لاكتشاف معرفات الشركات فقط
 * @param app واجهة التطبيق المقيدة بعزل الشركات
 * @param batchSize أقصى عدد صفوف في معاملة واحدة
 * @returns أعداد الشركات والصفوف المقروءة والمرقّمة دون أسماء
 */
export async function assignEmployeeNumbers(
  owner: postgres.Sql,
  app: DataStepApp,
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<EmployeeNumbersCounts> {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new RangeError('batchSize must be a positive integer');
  }
  const [role] = await owner<{ bypass: boolean }[]>`
    SELECT rolsuper OR rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`;
  if (role?.bypass !== true) throw new EmployeeNumbersRoleRefusedError();
  const companies = await owner<{ id: string }[]>`SELECT id FROM companies ORDER BY id`;
  const counts = { companies: companies.length, read: 0, assigned: 0, exhausted: 0 };
  for (const { id: companyId } of companies) {
    const seen = new Set<string>();
    for (;;) {
      const batch = await app.withTenant(companyId, (tx) =>
        numberOneBatch(tx, companyId, batchSize, seen),
      );
      counts.read += batch.read;
      counts.assigned += batch.assigned;
      counts.exhausted += batch.exhausted;
      if (batch.done || batch.exhausted > 0) break;
    }
  }
  if (counts.exhausted > 0) throw new EmployeeNumbersExhaustedError();
  return counts;
}

/**
 * يرقّم دفعة واحدة داخل معاملة الشركة: يقفل العدّاد، ويقرأ صفوف الموظفين بلا رقم، ويقرأ الأرقام المستخدمة من
 * العدّاد فما فوق، ثم يخطّط الدفعة ويطبّقها. الصفوف التي رقّمتها معاملة أخرى لا تُحتسب، والعدّاد لا يتحرك
 * إلا بالرقم الذي كُتب فعلاً. تصادم المفتاح الفريد يعود إلى savepoint ويعيد قراءة الصفوف والأرقام.
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة الجارية
 * @param batchSize أقصى عدد صفوف
 * @returns ما قُرئ وما رُقّم وما لم يتسع له النطاق
 */
async function numberOneBatch(
  tx: Tx,
  companyId: string,
  batchSize: number,
  seen: Set<string>,
): Promise<BatchCounts> {
  await ensureSequence(tx, companyId);
  const [sequence] = await tx.execute<{ next_number: number }>(
    sql`SELECT next_number FROM employee_number_sequences WHERE company_id = ${companyId} FOR UPDATE`,
  );
  if (sequence === undefined) return { read: 0, assigned: 0, exhausted: 0, done: true };
  const counter = sequence.next_number;
  let newRead = 0;
  let attempt = 0;
  for (;;) {
    const rows = await readNullBatch(tx, companyId, batchSize);
    for (const row of rows) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        newRead += 1;
      }
    }
    const firstRow = rows[0];
    if (firstRow === undefined) return { read: newRead, assigned: 0, exhausted: 0, done: true };
    const used = await readUsed(tx, companyId, counter);
    const plan = planAssignments(rows, counter, used);
    if (plan.assignments.length === 0) {
      const locked = await tx.execute<{ id: string }>(sql`
        SELECT id FROM employees
        WHERE company_id = ${companyId} AND id = ${firstRow.id} AND employee_number IS NULL
        FOR NO KEY UPDATE`);
      if (locked.length === 0) continue;
      return { read: newRead, assigned: 0, exhausted: plan.exhausted, done: true };
    }
    const attemptResult = await applyBatch(tx, companyId, plan.assignments);
    if (attemptResult.kind === 'skipped') continue;
    if (attemptResult.kind === 'conflict') {
      attempt += 1;
      if (attempt < MAX_BATCH_ATTEMPTS) continue;
      throw attemptResult.error;
    }
    const updated = attemptResult.rows;
    if (updated.length > 0) {
      await advanceCounter(tx, companyId, Math.max(counter, highestNumber(updated) + 1));
    }
    return { read: newRead, assigned: updated.length, exhausted: 0, done: false };
  }
}

/**
 * ينشئ صف عدّاد الشركة إن لم يكن موجوداً، قبل أول قفل عليه.
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة الجارية
 */
async function ensureSequence(tx: Tx, companyId: string): Promise<void> {
  await tx.execute(
    sql`INSERT INTO employee_number_sequences(company_id) VALUES (${companyId}) ON CONFLICT DO NOTHING`,
  );
}

/**
 * يقرأ صفوف الموظفين الذين بلا رقم وظيفي، بترتيب الترقيم: تاريخ التعيين ثم وقت الإنشاء ثم المعرف.
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة الجارية
 * @param batchSize أقصى عدد صفوف
 * @returns معرّفات الموظفين بلا رقم
 */
async function readNullBatch(
  tx: Tx,
  companyId: string,
  batchSize: number,
): Promise<{ id: string }[]> {
  return tx.execute<{ id: string }>(sql`
    SELECT id FROM employees
    WHERE company_id = ${companyId} AND employee_number IS NULL
    ORDER BY hire_date, created_at, id LIMIT ${batchSize}`);
}

/**
 * يقرأ الأرقام المستخدمة داخل الشركة من العدّاد فما فوق، في كل محاولة: معاملة أخرى قد تكون كتبت رقماً بعد
 * القراءة السابقة، فالقراءة القديمة كانت ستخصم رقماً محجوزاً.
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة الجارية
 * @param counter العدّاد المخزّن
 * @returns الأرقام المستخدمة
 */
async function readUsed(tx: Tx, companyId: string, counter: number): Promise<Set<number>> {
  const rows = await tx.execute<{ employee_number: number }>(sql`
    SELECT employee_number FROM employees
    WHERE company_id = ${companyId} AND employee_number >= ${counter}`);
  return new Set(rows.map((row) => row.employee_number));
}

/**
 * يخطّط أرقام الدفعة: أول رقم حر عند العدّاد أو بعده، والصفوف التي لم يتسع لها النطاق.
 *
 * @param rows صفوف بلا رقم
 * @param counter العدّاد المخزّن
 * @param used الأرقام المستخدمة من العدّاد فما فوق
 * @returns الخطة وعدد الصفوف التي لم يتسع لها النطاق
 */
function planAssignments(
  rows: readonly { id: string }[],
  counter: number,
  used: ReadonlySet<number>,
): BatchPlan {
  const assignments: Assignment[] = [];
  const taken = new Set(used);
  let cursor = counter;
  for (const row of rows) {
    const number = firstFreeEmployeeNumber(cursor, taken);
    if (number === null) return { assignments, exhausted: rows.length - assignments.length };
    assignments.push({ id: row.id, n: number });
    taken.add(number);
    cursor = number + 1;
  }
  return { assignments, exhausted: 0 };
}

/**
 * يطبّق خطة الدفعة في جملة واحدة داخل savepoint: تصادم المفتاح الفريد لو حدا بعد قراءة الأرقام المستخدمة
 * يترك المعاملة في حالة 25P02، والرجوع إلى الـ savepoint يرجّعها صالحة لإعادة القراءة.
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة الجارية
 * @param assignments الخطة
 * @returns الإسناد أو التصادم
 */
async function applyBatch(
  tx: Tx,
  companyId: string,
  assignments: readonly Assignment[],
): Promise<BatchAttempt> {
  if (assignments.length === 0) return { kind: 'assigned', rows: [] };
  try {
    const rows = await tx.transaction(async (nested) => {
      const updated = await nested.execute<AssignedRow>(sql`
        UPDATE employees e SET employee_number = v.n
        FROM jsonb_to_recordset(${JSON.stringify(assignments)}::jsonb) AS v(id uuid, n integer)
        WHERE e.company_id = ${companyId} AND e.id = v.id AND e.employee_number IS NULL
        RETURNING e.id, e.employee_number`);
      if (updated.length !== assignments.length) throw SKIPPED_ROW_ROLLBACK;
      return updated;
    });
    return { kind: 'assigned', rows };
  } catch (error) {
    if (error === SKIPPED_ROW_ROLLBACK) return { kind: 'skipped' };
    if (isUniqueViolation(error)) return { kind: 'conflict', error };
    throw error;
  }
}

/**
 * يقدّم العدّاد إلى الرقم الذي كُتب فعلاً زائد واحد، ولا يرجع به خلف قيمته المخزّنة.
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة الجارية
 * @param next العدّاد التالي
 */
async function advanceCounter(tx: Tx, companyId: string, next: number): Promise<void> {
  await tx.execute(
    sql`UPDATE employee_number_sequences SET next_number = GREATEST(next_number, ${next}), updated_at = now() WHERE company_id = ${companyId}`,
  );
}

/**
 * أعلى رقم كتبه التحديث فعلاً، لا أعلى رقم خطّطت له الدفعة.
 *
 * @param rows الصفوف التي غُيّرت
 * @returns أعلى رقم مكتوب
 */
function highestNumber(rows: readonly AssignedRow[]): number {
  return rows.reduce((highest, row) => Math.max(highest, row.employee_number), 0);
}

/**
 * يقرأ خطأ Postgres عبر سلسلة الأخطاء، فيعرف خطأ المفتاح الفريد 23505 ولو كان متداخلاً.
 *
 * @param error الخطأ المرصود
 * @returns true عند خطأ المفتاح الفريد
 */
function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  for (
    let current = error;
    typeof current === 'object' && current !== null && !seen.has(current);
    current = (current as { cause?: unknown }).cause
  ) {
    seen.add(current);
    if (String((current as { code?: unknown }).code) === '23505') return true;
  }
  return false;
}
