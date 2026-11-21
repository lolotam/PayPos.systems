import { ServiceError } from './errors.ts';
import type { ServiceImportTaggedCell } from './service-import-price-cell.ts';
import {
  validateServiceDuration,
  validateServiceNameAr,
  validateServiceNameEn,
} from './service-validation.ts';

/** رفض محوّل الخلية: نفس رموز أخطاء الصف في مواصفة 072. */
export type ServiceImportCellErrorCode =
  | 'IMPORT_REQUIRED_CELL'
  | 'IMPORT_NAME_INVALID'
  | 'IMPORT_CATEGORY_NOT_FOUND'
  | 'IMPORT_BOOLEAN_INVALID'
  | 'IMPORT_DURATION_INVALID'
  | 'IMPORT_CELL_INVALID';

/** نتيجة محوّل خلية اسم: القيمة المشذبة، أو «بلا قيمة» للخلية الفارغة، أو سبب الرفض. */
export type ServiceImportNameResult =
  | { readonly ok: true; readonly value: string | null }
  | { readonly ok: false; readonly code: ServiceImportCellErrorCode };

/** نتيجة محوّل خلية المدة: الدقائق الصحيحة، أو «بلا مدة»، أو سبب الرفض. */
export type ServiceImportDurationResult =
  | { readonly ok: true; readonly value: number | null }
  | { readonly ok: false; readonly code: ServiceImportCellErrorCode };

/** نتيجة محوّل خلية التصنيف: هوية التصنيف واسمه الإنجليزي المخزّن، أو «بلا تصنيف»، أو سبب الرفض. */
export type ServiceImportCategoryResult =
  | { readonly ok: true; readonly value: { readonly id: string; readonly nameEn: string } | null }
  | { readonly ok: false; readonly code: ServiceImportCellErrorCode };

/** نتيجة محوّل خلية الاحتساب: القيمة المنطقية أو سبب الرفض. */
export type ServiceImportBooleanResult =
  | { readonly ok: true; readonly value: boolean }
  | { readonly ok: false; readonly code: ServiceImportCellErrorCode };

/**
 * محلّل التصنيف المعطى للمحوّل من المستهلك (32b-2): نصّ الخلية المطلوب البحث به ↔ التصنيف المحلول
 * من قاعدة البيانات، أو `null` لمطابقة مفتوحة. المستهلك هو من ينفّذ استعلام Postgres على
 * النشاط والتصنيفات المفتوحة بتطبيع وألفة الفهرس نفسها، فالمحوّل الصافي لا يقوم بمسح أو تطبيع
 * عشوائي في جافاسكربت (A-11)، والكتابات غير اللاتينية تُحسم عند المُعرّف مرة واحدة.
 */
export type ServiceImportCategoryResolver = (
  lookupText: string,
) => { readonly id: string; readonly nameEn: string } | null;

// الأرقام ASCII فقط مع الصفر البادئ المقبول (090 = 90)؛ الصفر وحده يعدي النمط ويرفض من مدى المدة نفسه.
const WHOLE_MINUTES = /^[0-9]+$/;

const AFFIRMATIVE_WORD = String.fromCharCode(0x0646, 0x0639, 0x0645);
const NEGATIVE_WORD = String.fromCharCode(0x0644, 0x0627);
const BOOLEAN_TRUE = new Set(['true', 'yes', AFFIRMATIVE_WORD]);
const BOOLEAN_FALSE = new Set(['false', 'no', NEGATIVE_WORD]);

function cellError(cell: ServiceImportTaggedCell): ServiceImportCellErrorCode | null {
  return cell?.kind === 'error' ? 'IMPORT_CELL_INVALID' : null;
}

function cellAsText(cell: ServiceImportTaggedCell): string | null {
  return cell?.kind === 'text' || cell?.kind === 'numeric' ? cell.text.trim() : null;
}

/**
 * بيحوّل خلية اسم خدمة موسومة: النص بيتشذب ويُتحقق منه بمحقق الخدمة نفسه، والخلية الرقمية اسمها نصها،
 * والخلية الفارغة بترجع «بلا قيمة» في الاسم العربي ورفض «مطلوب» في الإنجليزي، وخلية إكسل المكسورة رفض
 * خلية على كل حال وما بتحولش لافتراضي أبداً (072 SIT-16).
 *
 * @param cell     الخلية الموسومة كما تركتها خطوة التوسيم، أو `null` لو الخانة فاضية
 * @param required هل الاسم إجباري (الاسم الإنجليزي) أم اختياري (العربي)
 * @returns الاسم المشذب أو «بلا قيمة»، أو سبب الرفض المسمّى
 */
export function parseServiceImportNameCell(
  cell: ServiceImportTaggedCell,
  required: boolean,
): ServiceImportNameResult {
  const broken = cellError(cell);
  if (broken !== null) return { ok: false, code: broken };
  if (cell === null)
    return required ? { ok: false, code: 'IMPORT_REQUIRED_CELL' } : { ok: true, value: null };
  const text = cellAsText(cell);
  if (text === null) return { ok: false, code: 'IMPORT_NAME_INVALID' };
  if (text === '')
    return required ? { ok: false, code: 'IMPORT_REQUIRED_CELL' } : { ok: true, value: null };
  try {
    if (required) validateServiceNameEn(text);
    else validateServiceNameAr(text);
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error;
    return { ok: false, code: 'IMPORT_NAME_INVALID' };
  }
  return { ok: true, value: text };
}

/**
 * بيحوّل خلية المدة الموسومة: نص أرقام ASCII كامل — وأرقام الصفر البادئة مقبولة فيصير `090` تسعين —
 * والخلية الرقمية بتقرأ من نصّها العشري (`1e2` الرقمية وصلت نصاً `100`)، والكسر والإشارة والصفر وما
 * فوق 600 رفض، والخلية الفارغة «بلا مدة»، وخلية إكسل المكسورة رفض خلية مش افتراضي.
 *
 * @param cell الخلية الموسومة أو `null` لو الخانة فاضية
 * @returns عدد الدقائق الصحيح أو «بلا مدة»، أو سبب الرفض المسمّى
 */
export function parseServiceImportDurationCell(
  cell: ServiceImportTaggedCell,
): ServiceImportDurationResult {
  const broken = cellError(cell);
  if (broken !== null) return { ok: false, code: broken };
  if (cell === null) return { ok: true, value: null };
  const text = cellAsText(cell);
  if (text === null) return { ok: false, code: 'IMPORT_DURATION_INVALID' };
  if (text === '') return { ok: true, value: null };
  if (!WHOLE_MINUTES.test(text)) return { ok: false, code: 'IMPORT_DURATION_INVALID' };
  const minutes = Number(text);
  const invalid = validateServiceDuration(minutes);
  if (invalid !== null) return { ok: false, code: 'IMPORT_DURATION_INVALID' };
  return { ok: true, value: minutes };
}

/**
 * بيحوّل خلية التصنيف الموسومة عبر محلّل معطى مسبقاً: نص الخلية المشذب هو نصّ البحث، والمحلّل هو
 * من يرجّع التصنيف المفتوح المحلول أو `null`، فلا مسح تطبيع في جافاسكربت ولا أول-مطابقة هنا؛
 * قرار المطابقة وحدودها (غير اللاتيني والتشكيل) بيد مستهلك قاعدة البيانات (32b-2). الخلية الفارغة
 * «بلا تصنيف»، وخلية إكسل المكسورة رفض خلية.
 *
 * @param cell            الخلية الموسومة أو `null` لو الخانة فاضية
 * @param resolveCategory محلّل نصّ البحث إلى التصنيف المفتوح المحلول أو `null`
 * @returns هوية التصنيف واسمه الإنجليزي المخزّن، أو «بلا تصنيف»، أو سبب الرفض المسمّى
 */
export function parseServiceImportCategoryCell(
  cell: ServiceImportTaggedCell,
  resolveCategory: ServiceImportCategoryResolver,
): ServiceImportCategoryResult {
  const broken = cellError(cell);
  if (broken !== null) return { ok: false, code: broken };
  if (cell === null) return { ok: true, value: null };
  const text = cellAsText(cell);
  if (text === null) return { ok: false, code: 'IMPORT_CATEGORY_NOT_FOUND' };
  if (text === '') return { ok: true, value: null };
  const matched = resolveCategory(text);
  if (matched === null) return { ok: false, code: 'IMPORT_CATEGORY_NOT_FOUND' };
  return { ok: true, value: { id: matched.id, nameEn: matched.nameEn } };
}

/**
 * بيحوّل خلية الاحتساب في المجمّع: الست كتابات المقبولة بالحالتين (true/false وyes/no ونعم/لا)،
 * والخلية المنطقية بقيمتها، والفراغ — ولا نص مسافات فقط — الاحتساب الافتراضي `true` (SR-005)،
 * وخلية إكسل المكسورة رفض خلية.
 *
 * @param cell الخلية الموسومة أو `null` لو الخانة فاضية
 * @returns قيمة الاحتساب أو سبب الرفض المسمّى
 */
export function parseServiceImportBooleanCell(
  cell: ServiceImportTaggedCell,
): ServiceImportBooleanResult {
  const broken = cellError(cell);
  if (broken !== null) return { ok: false, code: broken };
  if (cell === null) return { ok: true, value: true };
  if (cell.kind === 'boolean') return { ok: true, value: cell.value };
  // الخانة الفارغة — ولا نص مسافات فقط — هي غياب قيمة، والغياب في الاحتساب معناه الافتراضي `true`.
  if (cell.kind === 'text') {
    const word = cell.text.trim().toLowerCase();
    if (word === '') return { ok: true, value: true };
    if (BOOLEAN_TRUE.has(word)) return { ok: true, value: true };
    if (BOOLEAN_FALSE.has(word)) return { ok: true, value: false };
    return { ok: false, code: 'IMPORT_BOOLEAN_INVALID' };
  }
  return { ok: false, code: 'IMPORT_BOOLEAN_INVALID' };
}
