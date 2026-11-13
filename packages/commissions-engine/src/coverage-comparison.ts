/** هوية مدخل تغطية مع أحدث مراجعة معروفة له. */
export interface CoverageRow {
  readonly key: string;
  readonly revision: number;
}

/** نتيجة مقارنة المصدر بالإسقاط: العدد والمفاتيح الغائبة أو المتأخرة. */
export interface CoverageComparison {
  readonly checked: number;
  readonly missing: readonly string[];
  readonly stale: readonly string[];
}

function highestRevisions(rows: readonly CoverageRow[]): Map<string, number> {
  const revisions = new Map<string, number>();
  for (const row of rows) {
    const current = revisions.get(row.key);
    if (current === undefined || row.revision > current) revisions.set(row.key, row.revision);
  }
  return revisions;
}

function ascending(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * يقارن مراجعات المصدر بمراجعات الإسقاط وفق CM-20b؛ مراجعة إسقاط أحدث تغطي المصدر،
 * والمفاتيح الزائدة في الإسقاط لا تغيّر النتيجة، وأعلى مراجعة تُعتمد عند تكرار المفتاح.
 *
 * @param source صفوف المصدر المرجعية بهوياتها ومراجعاتها
 * @param projection صفوف الإسقاط المقابلة التي قد تكون ناقصة أو متأخرة أو متقدمة
 * @returns عدد مفاتيح المصدر الفريدة وقائمتا المفاتيح الغائبة والمتأخرة مرتبتين تصاعديًا
 */
export function compareCoverage(
  source: readonly CoverageRow[],
  projection: readonly CoverageRow[],
): CoverageComparison {
  const sources = highestRevisions(source);
  const projected = highestRevisions(projection);
  const missing: string[] = [];
  const stale: string[] = [];
  for (const [key, revision] of sources) {
    const projectedRevision = projected.get(key);
    if (projectedRevision === undefined) missing.push(key);
    else if (projectedRevision < revision) stale.push(key);
  }
  missing.sort(ascending);
  stale.sort(ascending);
  return { checked: sources.size, missing, stale };
}

/**
 * يستخرج الأحداث المحتفظ بها التي لم يستهلكها الـ consumer، مع منع تكرار المعرّف في التقرير.
 *
 * @param retainedEventIds معرّفات الأحداث المحتفظ بها بترتيب قراءتها
 * @param markedEventIds معرّفات الأحداث التي تحمل علامة الاستهلاك
 * @returns المعرّفات غير المعلّمة بترتيبها الأصلي وكل معرّف مرة واحدة
 */
export function findUnmarkedEventIds(
  retainedEventIds: readonly string[],
  markedEventIds: ReadonlySet<string>,
): string[] {
  const unmarked = new Set<string>();
  for (const eventId of retainedEventIds) {
    if (!markedEventIds.has(eventId)) unmarked.add(eventId);
  }
  return [...unmarked];
}

/**
 * يبني هوية مركبة ثابتة للتغطية دون تغيير أي جزء، ويمنع الغموض الذي يسببه الفاصل أو الجزء الفارغ.
 *
 * @param parts أجزاء الهوية بترتيبها، مثل الموظف وتاريخ السريان
 * @returns الأجزاء متصلة بفاصل | دون تغيير حالة الأحرف أو أي تحويل آخر
 */
export function coverageKey(...parts: readonly string[]): string {
  for (const part of parts) {
    if (part.length === 0 || part.includes('|')) {
      throw new RangeError('COVERAGE_KEY_PART_INVALID');
    }
  }
  return parts.join('|');
}
