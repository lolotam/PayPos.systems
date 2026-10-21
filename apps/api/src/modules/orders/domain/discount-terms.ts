import { moneyToString } from '@pospay/domain';
import { effectiveDiscountBps, lineNet } from './session-pricing.ts';

/** شروط الخصم التي وافقت عليها الموافقة: أي اختلاف في أي حقل يجعلها لا تصلح لسطر آخر. */
export interface DiscountTermsV1 {
  v: 1;
  company_id: string;
  business_id: string;
  branch_id: string;
  customer_id: string;
  session_id: string | null;
  occurred_business_date: string;
  service_id: string;
  list_price: string;
  price: string;
  discount: string;
  net: string;
  effective_bps: number;
  performer_ids: string[];
  requested_by: string;
  requested_by_membership_id: string;
}

/** مدخلات بناء الشروط: المعرّفات كما وصلت، والمبالغ بالفلوس قبل تحويلها إلى نص. */
export interface DiscountTermsInput {
  company_id: string;
  business_id: string;
  branch_id: string;
  customer_id: string;
  session_id: string | null;
  service_id: string;
  requested_by: string;
  requested_by_membership_id: string;
  occurred_business_date: string;
  list_price: bigint;
  price: bigint;
  discount: bigint;
  performer_ids: readonly string[];
}

/**
 * يبني شروط الخصم الموقّعة لسطر واحد، بحساب الصافي والنسبة الفعلية من دوال الجلسة نفسها.
 * القاعدة: الموافقة تُقاس على ما سيُكتب في السطر بالظبط — صافيها ونسبتها ومنفّذيها ومَن طلبها.
 * المعرّفات كلها تنزل بأحرف صغيرة، فكتابتان لنفس UUID تعطيان بصمة واحدة.
 *
 * @param input معرّفات السطر ومبالغه بالفلوس ومنفّذوه كما وصلوا من الاستدعاء
 * @returns شروط الخصم بصيغتها الموقّعة، المال فيها نص بثلاث خانات عشرية
 */
export function buildDiscountTerms(input: DiscountTermsInput): DiscountTermsV1 {
  const net = lineNet(input.price, input.discount);
  const effective_bps = effectiveDiscountBps(input.list_price, net);
  return {
    v: 1,
    company_id: input.company_id.toLowerCase(),
    business_id: input.business_id.toLowerCase(),
    branch_id: input.branch_id.toLowerCase(),
    customer_id: input.customer_id.toLowerCase(),
    session_id: input.session_id === null ? null : input.session_id.toLowerCase(),
    occurred_business_date: input.occurred_business_date,
    service_id: input.service_id.toLowerCase(),
    list_price: moneyToString(input.list_price),
    price: moneyToString(input.price),
    discount: moneyToString(input.discount),
    net: moneyToString(net),
    effective_bps,
    performer_ids: sortedDistinct(input.performer_ids),
    requested_by: input.requested_by.toLowerCase(),
    requested_by_membership_id: input.requested_by_membership_id.toLowerCase(),
  };
}

/**
 * يبني النص القانوني للشروط: مفاتيح مرتبة تصاعدياً في كل مستوى، بلا مسافات، والمصفوفات بترتيبها.
 * القاعدة: نفس الشروط تعطي نفس النص دائماً، والإصدار `v` جزء من النص، فتغييره يغيّر البصمة.
 *
 * @param terms شروط الخصم الموقّعة
 * @returns النص القانوني للشروط
 */
export function canonicalDiscountTerms(terms: DiscountTermsV1): string {
  return canonicalJson(terms);
}

/**
 * يحسب بصمة الشروط: تجزئة SHA-256 للنص القانوني، فالسطر المكتوب يطابق ما وافقت عليه الموافقة بالظبط.
 * الدالة الحاسبة تُحقن لأن ملف الـ domain لا يستورد `node:crypto` (CLAUDE.architecture.md §3.1)؛
 * المحوّل الذي سيهبط لاحقاً يمرّر تجزئة `node:crypto`، وهذا الاستثناء الوحيد على قائمة دوال المواصفة.
 *
 * @param terms شروط الخصم الموقّعة
 * @param sha256Hex دالة تُعيد تجزئة SHA-256 بستة وستين حرفاً hex صغير للنص المُعطى
 * @returns البصمة (64 حرف hex) للشروط
 */
export function discountTermsHash(
  terms: DiscountTermsV1,
  sha256Hex: (text: string) => string,
): string {
  return sha256Hex(canonicalDiscountTerms(terms));
}

/**
 * يكتب أي قيمة بنص JSON قانوني: المفاتيح مرتبة تصاعدياً في كل مستوى والمصفوفات بترتيبها.
 * القاعدة: نفس القيمة تعطي نفس النص دائماً، فالبصمة لا تتغيّر بإعادة ترتيب المفاتيح.
 *
 * @param value القيمة المراد كتابتها
 * @returns النص القانوني للقيمة
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * ينزّل المعرّفات إلى أحرف صغيرة، ويرتّبها تصاعدياً، ويزيل التكرار.
 * القاعدة: ترتيب المنفّذين جزء من الشروط لا من المصادفة، فترتيبهم في المُدخل لا يغيّر البصمة.
 *
 * @param values المعرّفات كما وصلت
 * @returns المعرّفات النازلة والمرتبة بلا تكرار
 */
function sortedDistinct(values: readonly string[]): string[] {
  const lowered = values.map((value) => value.toLowerCase());
  const sorted = lowered.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return [...new Set(sorted)];
}
