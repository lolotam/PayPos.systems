import { serviceCategoryKey } from './service-category.ts';

/**
 * مفتاح اسم الخدمة داخل الملف (FR-007 وSI-Q1): الاسم المشذب بمسافات مطبّعة إلى مسافة واحدة ثم بحروف
 * صغيرة — بنفس المعمِِّر العامل اللي بيولّد مفتاح فهرس التصنيفات، مش بتعبير تاني بيحاكيه. الاسم العربي
 * والتصنيف ما بيدخلوش في المفتاح، والأساس هو مفتاح الـ API الحالي وحدّه (A-9/A-11).
 *
 * @param nameEn الاسم الإنجليزي كما مرّ من محقق الاسم
 * @returns مفتاح التشابه داخل الملف
 */
export function serviceImportNameKey(nameEn: string): string {
  return serviceCategoryKey(nameEn);
}

/**
 * بيحدد كل صفوف التكرار داخل الملف دفعة واحدة: كل مجموعة ليها مفتاح واحد متكرر بتُرجَع كلها —
 * مش المتأخروا بس — حتى لو عمود تاني في الصف غلط، طالما الاسم الإنجليزي نفسه سليم ومتطبع
 * (A-10). اللي بيقرر التكرار هو المفتاح بس، وترتيب الإرجاع بيحافظ على ترتيب الصفوف في الورقة.
 *
 * @param keyedRows أرقام الصفوف مع مفاتيح أسمائها، بترتيب الورقة
 * @returns أرقام كل الصفوف اللي هييجي عليها `IMPORT_DUPLICATE_IN_FILE` بترتيب الورقة
 */
export function serviceImportDuplicateRows(
  keyedRows: readonly { readonly row: number; readonly key: string }[],
): readonly number[] {
  const counts = new Map<string, number>();
  for (const entry of keyedRows) counts.set(entry.key, (counts.get(entry.key) ?? 0) + 1);
  return keyedRows
    .filter((entry) => (counts.get(entry.key) ?? 0) > 1)
    .map((entry) => entry.row);
}
