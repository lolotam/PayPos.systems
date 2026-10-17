import { SessionError } from './session-error.ts';

/** بند زيارة يساهم في وزن البقشيش بصافيه وحصص منفّذاته. */
export interface TipWeightLine {
  status: 'ACTIVE' | 'CANCELLED';
  net: bigint;
  performers: readonly { employee_id: string; share_bps: number }[];
}

/** وزن موظفة واحدة من صافي الزيارة، بالفلس. */
export interface TipWeight {
  employee_id: string;
  weight: bigint;
}

/** مبلغ بقشيش مقترح لموظفة واحدة، بالفلس. */
export interface TipSuggestion {
  employee_id: string;
  amount: bigint;
}

/**
 * يرتّب هويات الموظفات تصاعدياً بعد توحيد حالة الأحرف.
 * المعرّف نفسه بحروف مختلفة هو موظفة واحدة، والترتيب يطابق تقسيم العمولة.
 *
 * @param left هوية الموظفة الأولى
 * @param right هوية الموظفة الثانية
 * @returns سالب لو الأولى أصغر، وصفر عند التساوي، وموجب لو الثانية أصغر
 */
function compareEmployeeId(left: string, right: string): number {
  const lowerLeft = left.toLowerCase();
  const lowerRight = right.toLowerCase();
  return lowerLeft < lowerRight ? -1 : lowerLeft > lowerRight ? 1 : 0;
}

/**
 * يوزّع صافي بند واحد بالفلس: أرضية كل حصة ثم باقي الفلس للهوية الأصغر.
 * نفس قاعدة نصيب السطر في المواصفة، معاد تنفيذها هنا حتى لا يستورد الطلباتُ العمولات.
 *
 * @param net صافي البند بالفلس
 * @param performers حصص المنفّذات على البند
 * @returns نصيب كل موظفة بالفلس، والمفتاح هو الهوية بحروف صغيرة
 */
function allocateLineMills(
  net: bigint,
  performers: readonly { employee_id: string; share_bps: number }[],
): Map<string, bigint> {
  const ordered = [...performers].sort((left, right) =>
    compareEmployeeId(left.employee_id, right.employee_id),
  );
  const shares = new Map<string, bigint>();
  for (const performer of ordered) {
    const employeeId = performer.employee_id.toLowerCase();
    const floorShare = (net * BigInt(performer.share_bps)) / 10000n;
    shares.set(employeeId, (shares.get(employeeId) ?? 0n) + floorShare);
  }
  let remainder = net;
  for (const share of shares.values()) remainder -= share;
  for (const employeeId of shares.keys()) {
    if (remainder <= 0n) break;
    shares.set(employeeId, (shares.get(employeeId) ?? 0n) + 1n);
    remainder -= 1n;
  }
  return shares;
}

/**
 * يجمع وزن كل موظفة من صافي البنود الفعّالة فقط.
 * البند الملغي لا يدخل لأن الخدمة لم تُقدَّم، والموظفة على أكثر من بند تُحسب مرة بمجموع أنصبتها.
 *
 * @param lines بنود الزيارة بحالتها وصافيها وحصص المنفّذات
 * @returns الأوزان بالفلس مرتبة بهوية الموظفة، والصفر يبقى ظاهراً حتى ينفع التقسيم المتساوي
 */
export function performerNetWeights(lines: readonly TipWeightLine[]): TipWeight[] {
  const totals = new Map<string, bigint>();
  for (const line of lines) {
    if (line.status !== 'ACTIVE') continue;
    for (const [employeeId, share] of allocateLineMills(line.net, line.performers)) {
      totals.set(employeeId, (totals.get(employeeId) ?? 0n) + share);
    }
  }
  return [...totals.entries()]
    .sort(([left], [right]) => compareEmployeeId(left, right))
    .map(([employee_id, weight]) => ({ employee_id, weight }));
}

/**
 * يدمج أوزان الهوية الواحدة مهما اختلفت حالة حروفها.
 *
 * @param weights الأوزان كما وصلت
 * @returns وزن واحد لكل موظفة، مرتباً بهويتها
 */
function mergeWeights(weights: readonly TipWeight[]): TipWeight[] {
  const totals = new Map<string, bigint>();
  for (const row of weights) {
    const employeeId = row.employee_id.toLowerCase();
    totals.set(employeeId, (totals.get(employeeId) ?? 0n) + row.weight);
  }
  return [...totals.entries()]
    .sort(([left], [right]) => compareEmployeeId(left, right))
    .map(([employee_id, weight]) => ({ employee_id, weight }));
}

interface RemainderRow {
  employee_id: string;
  amount: bigint;
  remainder: bigint;
}

/**
 * يعطي كل موظفة الجزء الصحيح من نصيبها ثم يوزّع الفلس الباقي على أكبر الكسور.
 * التعادل يروح للهوية الأصغر، والنتيجة من غير مبالغ صفر حتى يبقى كل مبلغ محفوظاً أكبر من صفر.
 *
 * @param tip البقشيش بالفلس
 * @param weights أوزان موجبة أو متساوية عند صافي صفر
 * @param divisor مجموع الأوزان، أو عدد الموظفات عند التقسيم المتساوي
 * @returns المبالغ المقترحة مرتبة بهوية الموظفة
 */
function largestRemainder(
  tip: bigint,
  weights: readonly TipWeight[],
  divisor: bigint,
): TipSuggestion[] {
  const rows: RemainderRow[] = weights.map((row) => {
    const product = tip * row.weight;
    return {
      employee_id: row.employee_id,
      amount: product / divisor,
      remainder: product % divisor,
    };
  });
  let leftover = tip;
  for (const row of rows) leftover -= row.amount;
  const byRemainder = [...rows].sort((left, right) => {
    if (left.remainder !== right.remainder) return left.remainder > right.remainder ? -1 : 1;
    return compareEmployeeId(left.employee_id, right.employee_id);
  });
  const extra = new Set<string>();
  for (const row of byRemainder) {
    if (leftover <= 0n) break;
    extra.add(row.employee_id);
    leftover -= 1n;
  }
  return rows
    .map((row) => ({
      employee_id: row.employee_id,
      amount: row.amount + (extra.has(row.employee_id) ? 1n : 0n),
    }))
    .filter((row) => row.amount > 0n)
    .sort((left, right) => compareEmployeeId(left.employee_id, right.employee_id));
}

/**
 * يقترح تقسيم البقشيش على أوزان صافي الزيارة بحيث يساوي المجموع البقشيش بالظبط.
 * كل موظفة تأخذ أرضية نصيبها والفلس الباقي لأكبر الكسور، والتعادل للهوية الأصغر؛ والزيارة ذات الصافي صفر تُقسَم بالتساوي.
 *
 * @param tip البقشيش المطلوب تقسيمه بالفلس، وأصغر قيمة مقبولة فلس واحد
 * @param weights أوزان الموظفات من صافي الزيارة؛ كلها صفر تعني زيارة صافيها صفر
 * @returns مبالغ الاقتراح بالفلس مرتبة بهوية الموظفة، ومن غير أي مبلغ صفر
 */
export function suggestTipSplit(tip: bigint, weights: readonly TipWeight[]): TipSuggestion[] {
  if (tip <= 0n) throw new SessionError('VALIDATION_FAILED');
  const merged = mergeWeights(weights);
  if (merged.length === 0) return [];
  const total = merged.reduce((sum, row) => sum + row.weight, 0n);
  // صافي الزيارة صفر فلا يوجد وزن يُنسَب إليه، والتساوي هو الاقتراح الذي يحفظ المجموع.
  if (total === 0n)
    return largestRemainder(
      tip,
      merged.map((row) => ({ ...row, weight: 1n })),
      BigInt(merged.length),
    );
  return largestRemainder(tip, merged, total);
}
