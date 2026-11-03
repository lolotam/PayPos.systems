import { moneyToString } from '@pospay/domain';

import { ServiceError } from './errors.ts';
import { parseServicePrice } from './service.ts';

/**
 * الخلية الموسومة كما تتركها خطوة التوسيم العامة عند حدّ القراءة (FR-005):
 * نص، أو رقم بنصّه العشري، أو منطقي، أو رقم ما بيتمثّل، أو خطأ إكسل، أو فراغ.
 * الشكل ده هو مدخل محوّل السعر الوحيد: رقم جافاسكربت ما بيعديش حدّ التوسيم، وده اللي بنرفضه.
 */
export type ServiceImportTaggedCell =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'numeric'; readonly text: string; readonly percentFormat: boolean }
  | { readonly kind: 'numeric-unrepresentable'; readonly display: string }
  | { readonly kind: 'error' }
  | null;

/** سبب رفض خلية السعر: نفس أسماء أخطاء الصفوف في مواصفة الاستيراد 072. */
export type ServiceImportPriceErrorCode =
  'IMPORT_REQUIRED_CELL' | 'IMPORT_PRICE_INVALID' | 'IMPORT_CELL_INVALID';

/** نتيجة المحوّل: نص السعر كويتي بثلاث خانات وفلوسه، أو سبب الرفض المسمّى. */
export type ServiceImportPriceResult =
  | { readonly ok: true; readonly price: string; readonly mills: bigint }
  | { readonly ok: false; readonly code: ServiceImportPriceErrorCode };

// نص عشري بلا أس: صفر أو رقم صحيح من غير أصفار بادئة، وعشرية من خانة لثلاث.
// السطر ده يحمل رفض FR-005 كله: السالب والأس والفواصل والأرقام غير اللاتينية والخانة الرابعة،
// وكل قيمة عند 10^11 دينار أو أعلى (أحد عشر رقماً قبل الفاصلة).
const PRICE_TEXT = /^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/;

/**
 * يحوّل خلية السعر الموسومة إلى نص كويتي بثلاث خانات عشرية، من غير أي حساب عشري.
 * نص الخلية هو المصدر: الرقم بيتمثّل نصاً قبل ما يوصل هنا، فالمال ما بيمرّش برقم جافاسكربت.
 * الخانة الفارغة في عمود مطلوب رفض، وخلية خطأ إكسل رفض تاني، وما ينفعش واحدة منهم تاخد قيمة افتراضية.
 * السعر السليم بيرجع نصه وفلوسه من parseServicePrice، وهي المرجع الوحيد لرقم المبلغ.
 *
 * @param cell الخلية الموسومة كما تركها خطوة التوسيم، أو `null` لو الخانة فاضية
 * @returns نص السعر بثلاث خانات وفلوسه، أو سبب الرفض المسمّى
 */
export function parseServiceImportPriceCell(
  cell: ServiceImportTaggedCell,
): ServiceImportPriceResult {
  if (cell === null) return { ok: false, code: 'IMPORT_REQUIRED_CELL' };
  // أي مدخل مش كائن (رقم أو نص أو `undefined`) خلية مكسورة: ما بنحوّلهوش لنص.
  if (typeof cell !== 'object') return { ok: false, code: 'IMPORT_CELL_INVALID' };
  switch (cell.kind) {
    case 'text':
      return priceFromText(cell.text);
    case 'numeric':
      // FR-005 يقرأ نص السعر نفسه؛ التحجيم حسب التنسيق خاص بعمولة PCT في FR-006.
      return priceFromText(cell.text);
    case 'boolean':
    case 'numeric-unrepresentable':
      return { ok: false, code: 'IMPORT_PRICE_INVALID' };
    case 'error':
      return { ok: false, code: 'IMPORT_CELL_INVALID' };
    default:
      return { ok: false, code: 'IMPORT_CELL_INVALID' };
  }
}

// نص الخلية لازم يكون نص عشري مسموح؛ نص تاني رفض، والفراغ رفض لأن العمود مطلوب.
function priceFromText(value: unknown): ServiceImportPriceResult {
  if (typeof value !== 'string') return { ok: false, code: 'IMPORT_CELL_INVALID' };
  const text = value.trim();
  if (text === '') return { ok: false, code: 'IMPORT_REQUIRED_CELL' };
  if (!PRICE_TEXT.test(text)) return { ok: false, code: 'IMPORT_PRICE_INVALID' };
  const dot = text.indexOf('.');
  const whole = dot === -1 ? text : text.slice(0, dot);
  const fraction = dot === -1 ? '' : text.slice(dot + 1);
  // الثلاث خانات بتتمعل نصاً: الأصفار الباقية من غير أي رقم عشري.
  const canonical = `${whole}.${fraction.padEnd(3, '0')}`;
  try {
    const mills = parseServicePrice(canonical);
    return { ok: true, price: moneyToString(mills), mills };
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error;
    return { ok: false, code: 'IMPORT_PRICE_INVALID' };
  }
}
