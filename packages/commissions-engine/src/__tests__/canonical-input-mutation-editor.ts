import { buildCanonicalInput } from '../canonical-input.ts';
import { fullRows } from './canonical-input-expected.ts';
import { PERIOD, type StatementMonthRows } from './statement-fixtures.ts';

/**
 * تعديل واحد على حقل واحد من `fullRows()`.
 * - `field`: مسار الورقة العام (`[]` لكل عنصر قايمة)، وبيتقارن بأوراق القيمة المكتوبة بإيدي.
 * - `ids`: هوية الصف الأساسية لكل `[]` في `field` بالترتيب (الموظفة، ثم الصف، ثم خطوة الشريحة).
 * - `row`: مسار الصف العام، وبتتبني عليه `alsoChanges`.
 * - `alsoChanges`: الأوراق (نسبةً للصف) اللي بتتغير حتماً مع الحقل: قيمة القاعدة بتتكتب حسب
 *   نوعها، وحقل اتشال بيشيل أوراقه. أي ورقة غيرها بتتغير بتفشل الاختبار.
 * - `moves`: التعديل بينقل صفاً لموظفة تانية، فمفيش عزل ممكن وله اختباره.
 */
export interface FieldMutation {
  readonly field: string;
  readonly label?: string;
  readonly run: () => string;
  readonly ids: readonly string[];
  readonly row: string;
  readonly alsoChanges?: readonly string[];
  readonly moves?: true;
}

/** أوراق بتتغير حتماً مع الحقل، أو نقل الصف لموظفة تانية، أو تسمية التعديل، أو هوية خطوات الشريحة. */
export interface MutationExtra {
  readonly alsoChanges?: readonly string[];
  readonly moves?: true;
  readonly label?: string;
  readonly stepIds?: readonly string[];
}

const ROW_PATH: Record<keyof StatementMonthRows, string> = {
  lines: 'employees[].lines[]',
  sales: 'employees[].sales[]',
  tips: 'employees[].tips[]',
  salaries: 'employees[]',
  versions: 'employees[].versions[]',
  overrides: 'employees[].overrides[]',
  corrections: 'employees[].corrections[]',
  blocked: 'employees[].blocked_corrections[]',
  carries: 'employees[].carries[]',
};

/**
 * هوية الصف الأساسية كما بتتكتب في المسارات: الموظفة، ثم الصف.
 *
 * @param key القايمة
 * @param row الصف من `fullRows()`
 * @returns الهويات بالترتيب
 */
function identitiesOf(key: keyof StatementMonthRows, row: Record<string, unknown>): string[] {
  const employee = String(row['employeeId'] ?? row['sellerEmployeeId']);
  const rowId: Record<keyof StatementMonthRows, string> = {
    lines: String(row['lineId']),
    sales: String(row['saleId']),
    tips: `${String(row['sessionId'])}:${String(row['method'])}`,
    salaries: '',
    versions: String(row['version']),
    overrides: String(row['id']),
    corrections: `${String(row['sourcePeriod'])}|${String(row['sourceRef'])}|${String(row['generation'])}`,
    blocked: String(row['sourcePeriod']),
    carries: `${String(row['sourceStatementId'])}:${String(row['kind'])}`,
  };
  return key === 'salaries' ? [employee] : [employee, rowId[key]];
}

/**
 * يعدّل عنصر واحد في قايمة من `fullRows()` بتعديل واحد.
 *
 * @param field مسار الورقة العام
 * @param key القايمة
 * @param index موضع العنصر في `fullRows()`
 * @param change الحقل أو الحقول اللي بتتغير
 * @param extra الأوراق اللي بتتغير حتماً مع الحقل، أو `moves`، أو هوية الخطوات
 * @returns التعديل
 */
export function edit<K extends keyof StatementMonthRows>(
  field: string,
  key: K,
  index: number,
  change: Partial<StatementMonthRows[K][number]>,
  extra: MutationExtra = {},
): FieldMutation {
  const base: readonly object[] = fullRows()[key];
  const run = () => {
    const rows = fullRows();
    const list: readonly object[] = rows[key];
    const next = list.map((item, position) => (position === index ? { ...item, ...change } : item));
    return JSON.stringify(
      buildCanonicalInput(PERIOD, { ...rows, [key]: next } as StatementMonthRows),
    );
  };
  const target = base[index] as Record<string, unknown>;
  const { stepIds = [], ...rest } = extra;
  return {
    field,
    run,
    ids: [...identitiesOf(key, target), ...stepIds],
    row: ROW_PATH[key],
    ...rest,
  };
}
