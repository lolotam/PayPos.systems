/**
 * الإثبات المخزّن لتغطية بيانات الشركة القديمة كما يرجعه `read_commission_coverage_gate` (ADR-0054، إضافة
 * 2026-11-22 البند 1): الإثبات الحالي هو الذي يساوي توليده توليد صف الحالة، فالدالة ترجّع إثباتًا واحدًا أو لا شيء.
 * الحقول بنفس أسماء الأعمدة المخزّنة بعد تحويلها لـcamelCase، والتواريخ نصوص `YYYY-MM-DD`.
 */
export interface StoredCoverageProof {
  /** رقم نسخة قواعد الإثبات عند الإصدار. */
  readonly version: number;
  /** كل أنشطة الشركة وقت الإصدار، مرتبة وغير فارغة (ADR-0054 §6). */
  readonly businessIds: readonly string[];
  /** أول يوم تحقّق منه فحص البقشيش. */
  readonly tipFrom: string;
  /** آخر يوم تحقّق منه فحص البقشيش. */
  readonly tipTo: string;
  /** حد البقشيش U: تاريخ الإصدار بتوقيت UTC زائد يوم، من ساعة PostgreSQL (§6). */
  readonly tipDayBound: string;
  /** الأنواع المعدودة وقت الإصدار. */
  readonly countedTypes: readonly string[];
  /** معرّف المستهلك وقت الإصدار. */
  readonly consumerId: string;
  /** اسم قاعدة البيانات التي أُصدر عليها الإثبات. */
  readonly databaseName: string;
  /** معرّف نظام الـcluster الذي أُصدر عليه الإثبات، نصًا لأنه bigint. */
  readonly systemId: string;
}

/** ما يتوقعه الاعتماد من الإثبات: ثوابت الملف التنفيذي وهوية قاعدة البيانات الحالية. */
export interface ExpectedCoverageRules {
  readonly version: number;
  readonly countedTypes: readonly string[];
  readonly consumerId: string;
  readonly databaseName: string;
  readonly systemId: string;
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * أول وآخر يوم في شهر بصيغة YYYY-MM.
 *
 * @param period الشهر
 * @returns أول يوم وآخر يوم بصيغة YYYY-MM-DD
 * @throws RangeError لشهر بصيغة غير صالحة
 */
function monthBounds(period: string): { readonly first: string; readonly last: string } {
  const match = MONTH.exec(period);
  if (match === null) throw new RangeError(`Invalid statement period: ${period}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { first: `${period}-01`, last: `${period}-${String(lastDay).padStart(2, '0')}` };
}

/**
 * يقارن قائمتين من النصوص كمجموعتين: نفس العناصر بنفس العدد بغض النظر عن الترتيب.
 *
 * @param stored القائمة المخزّنة في الإثبات
 * @param expected القائمة التي يتوقعها الاعتماد
 * @returns هل هما نفس المجموعة
 */
function sameSet(stored: readonly string[], expected: readonly string[]): boolean {
  if (stored.length !== expected.length) return false;
  const left = [...stored].sort();
  const right = [...expected].sort();
  return left.every((value, index) => value === right[index]);
}

/**
 * هل الإثبات صالح لقواعد الإصدار الحالي وقاعدة البيانات الحالية؟ أي اختلاف في النسخة أو الأنواع المعدودة أو
 * المستهلك أو اسم القاعدة أو معرّف النظام يعني أن الإثبات قديم أو منقول، فيُرفض (ADR-0054 §5). التحقق من أنه
 * «الإثبات الحالي» (توليده يساوي توليد الحالة) تفعله دالة الداتابيز التي تعيد إثباتًا أو لا شيء.
 *
 * @param proof الإثبات المقروء
 * @param expected ثوابت الاعتماد الحالية وهوية قاعدة البيانات
 * @returns true لو كل ما سبق مطابق
 */
export function isCoverageProofValid(
  proof: StoredCoverageProof,
  expected: ExpectedCoverageRules,
): boolean {
  return (
    proof.version === expected.version &&
    proof.databaseName === expected.databaseName &&
    proof.systemId === expected.systemId &&
    proof.consumerId === expected.consumerId &&
    sameSet(proof.countedTypes, expected.countedTypes)
  );
}

/**
 * هل نطاق الإثبات يشمل هذا النشاط وهذا الشهر؟ النشاط الغائب عن قائمة الإثبات مرفوض حتى يصدر إثبات جديد، والشهر
 * مقبول لو F > U (كل أيامه بعد حد البقشيش) أو لو مدى البقشيش المتحقق منه يغطي F … min(L, U) (ADR-0054 §6). المدى
 * يخص أيام البقشيش القديم فقط؛ ما بعد U لم يوجد فيه سجل أصلي لحظة الإصدار فعدّاد الأحداث يغطيه.
 *
 * @param proof الإثبات المقروء
 * @param businessId النشاط المطلوب اعتماده
 * @param period شهر الكشف بصيغة YYYY-MM
 * @returns true لو النشاط والشهر داخل نطاق الإثبات
 */
export function coverageProofAdmits(
  proof: StoredCoverageProof,
  businessId: string,
  period: string,
): boolean {
  if (!proof.businessIds.includes(businessId)) return false;
  const { first, last } = monthBounds(period);
  const bound = proof.tipDayBound;
  if (first > bound) return true;
  const needsUntil = last < bound ? last : bound;
  return proof.tipFrom <= first && proof.tipTo >= needsUntil;
}
