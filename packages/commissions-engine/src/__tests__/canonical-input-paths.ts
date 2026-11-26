/**
 * مسارات الأوراق (leaves) في قيمة JSON، والعنصر في القايمة بيتكتب `[]`.
 *
 * @param value القيمة
 * @param path المسار لحد هنا
 * @returns مسارات الأوراق
 */
export function leafPaths(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => leafPaths(item, `${path}[]`));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      leafPaths(item, path === '' ? key : `${path}.${key}`),
    );
  }
  return [path];
}

export type Row = Record<string, unknown>;

/** هوية الصف في كل قايمة بيتبصم صفها؛ القايمة اللي مالهاش هوية (خطوات الشرائح) بتتعرّف بموضعها. */
const IDENTITY: Record<string, (row: Row) => string> = {
  employees: (row) => String(row['employee_id']),
  lines: (row) => String(row['line_id']),
  sales: (row) => String(row['sale_id']),
  tips: (row) => `${String(row['session_id'])}:${String(row['method'])}`,
  versions: (row) => String(row['version']),
  overrides: (row) => String(row['id']),
  corrections: (row) =>
    `${String(row['source_period'])}|${String(row['source_ref'])}|${String(row['generation'])}`,
  blocked_corrections: (row) => String(row['source_period']),
  carries: (row) => `${String(row['source_statement_id'])}:${String(row['kind'])}`,
};

/**
 * كل ورقة بمسارها الكامل وهوية صفها: الصف في الموضع i بياخد هوية الصف الأساسي في نفس الموضع، فتعديل
 * في هوية صف (line_id مثلاً) بيظهر كتغيّر في الورقة دي بس، وصف اتحرّك من مكانه بيبيّن أوراق غيره.
 * هوية مكررة في نفس القايمة معناها صفّين ورا بعض بنفس المسار، فالمقارنة بترمي بدل ما تبلع أول ورقة.
 *
 * @param value القيمة القياسية
 * @param base القيمة الأساسية اللي بتدّي الهويات
 * @param path المسار لحد هنا
 * @param name اسم الحقل اللي القيمة تحته
 * @param out الأوراق المجمّعة
 * @returns الأوراق بمساراتها
 */
export function labelledLeaves(
  value: unknown,
  base: unknown,
  path = '',
  name = '',
  out = new Map<string, unknown>(),
): Map<string, unknown> {
  if (Array.isArray(value)) {
    const baseList = Array.isArray(base) ? base : [];
    const identity = IDENTITY[name];
    const labels = new Set<string>();
    const seen = new Set<string>();
    value.forEach((item, index) => {
      if (identity !== undefined) {
        const own = identity(item as Row);
        if (seen.has(own)) {
          throw new Error(`Duplicate row identity "${own}" in ${path === '' ? name : path}`);
        }
        seen.add(own);
      }
      const source = (baseList[index] ?? item) as Row;
      const label = identity === undefined ? String(index) : identity(source);
      if (labels.has(label)) {
        throw new Error(`Duplicate row identity "${label}" in ${path === '' ? name : path}`);
      }
      labels.add(label);
      labelledLeaves(item, baseList[index], `${path}[${label}]`, name, out);
    });
  } else if (value !== null && typeof value === 'object') {
    const baseObject = (base ?? {}) as Row;
    for (const [key, item] of Object.entries(value)) {
      labelledLeaves(item, baseObject[key], path === '' ? key : `${path}.${key}`, key, out);
    }
  } else {
    if (out.has(path)) {
      throw new Error(`Duplicate leaf path "${path}" in the compared values`);
    }
    out.set(path, value);
  }
  return out;
}

/**
 * الأوراق اللي اختلفت بين القيمة الأساسية والمعدّلة (أو اتضافت أو اتشالت)، بمسارها الكامل بهويات الصفوف.
 *
 * @param before القيمة الأساسية
 * @param after القيمة بعد التعديل
 * @returns مسارات الأوراق المتغيّرة
 */
export function changedPaths(before: unknown, after: unknown): string[] {
  const a = labelledLeaves(before, before);
  const b = labelledLeaves(after, before);
  const changed: string[] = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    if (!a.has(key) || !b.has(key) || a.get(key) !== b.get(key)) changed.push(key);
  }
  return changed.sort();
}

/**
 * يملا كل `[]` في المسار العام بهوية الصف الأساسية بالترتيب.
 *
 * @param path المسار العام
 * @param ids الهويات بالترتيب
 * @returns المسار بهويات الصفوف
 */
export function fill(path: string, ids: readonly string[]): string {
  let next = 0;
  return path.replace(/\[\]/g, () => `[${ids[next++] ?? '?'}]`);
}
