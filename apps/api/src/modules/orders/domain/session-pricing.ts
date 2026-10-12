import { lineNet as moneyLineNet, discountFromPercent as moneyDiscountFromPercent, sumMoney } from '@pospay/domain';
import { SessionError } from './session-error.ts';
import type { PreparedSessionLine, SessionLimit } from './session-types.ts';

/**
 * يحسب صافي البند ويمنع الخصم الأكبر من السعر قبل أي حفظ.
 * يستخدم حساب المال المشترك ويحول رفضه إلى رمز الجلسة الثابت للعميل.
 *
 * @param price السعر المدخل بالفلس
 * @param discount مبلغ الخصم بالفلس
 * @returns الصافي الصحيح بالفلس
 */
export function lineNet(price: bigint, discount: bigint): bigint {
  try { return moneyLineNet(price, discount); }
  catch { throw new SessionError('SESSION_DISCOUNT_INVALID'); }
}
/**
 * يقرب مبلغ الخصم نصفياً لأعلى؛ لا يخفضه لإدخاله في حد الشخص.
 * يستخدم نفس دالة المتصفح ويحتفظ برمز رفض الخصم الخاص بالجلسة.
 *
 * @param price السعر بالفلس
 * @param bps النسبة بوحدات أساس
 * @returns الخصم بالفلس بعد تقريب SS-Q5
 */
export function discountFromPercent(price: bigint, bps: number): bigint {
  try { return moneyDiscountFromPercent(price, bps); }
  catch { throw new SessionError('SESSION_DISCOUNT_INVALID'); }
}
/**
 * يحتسب تخفيض السعر أيضاً؛ كسر أعلى من السلطة يرفض بالتقريب لأعلى حسب D-56.
 *
 * @param listPrice سعر القائمة بالفلس
 * @param net الصافي بالفلس
 * @returns الخصم الفعلي بوحدات أساس صحيحة
 */
export function effectiveDiscountBps(listPrice: bigint, net: bigint): number {
  lineNet(listPrice, 0n); lineNet(net, 0n);
  if (listPrice === 0n || net >= listPrice) return 0;
  return Number(((listPrice - net) * 10000n + listPrice - 1n) / listPrice);
}
/**
 * يحدد أدنى صافي وأكبر خصم إضافي دون تقريب سلطة الشخص لأسفل.
 *
 * @param listPrice سعر القائمة
 * @param price السعر المدخل
 * @param limitBps الحد المطبق
 * @returns قيم العرض التي تساعد على تصحيح بند مرفوض
 */
export function authorizedDiscountAmounts(listPrice: bigint, price: bigint, limitBps: number) {
  lineNet(listPrice, 0n); lineNet(price, 0n);
  if (!Number.isInteger(limitBps) || limitBps < 0 || limitBps > 10000) throw new SessionError('FORBIDDEN');
  const minimum_net = (listPrice * BigInt(10000 - limitBps) + 9999n) / 10000n;
  const additional = price > minimum_net ? price - minimum_net : 0n;
  return { minimum_net, max_discount_amount: additional > price ? price : additional };
}
/**
 * يفصل تجاوز الحد فقط بعد تحقق بقية القواعد؛ لا يكتب أي أثر.
 *
 * @param lines كل البنود الصحيحة في الطلب
 * @param limit سلطة الشخص المحلولة في نفس المعاملة
 * @returns المقبول والمرفوض بترتيب المدخل
 */
export function partitionDiscountLines(lines: readonly PreparedSessionLine[], limit: SessionLimit) {
  const accepted: PreparedSessionLine[] = [], rejected: PreparedSessionLine[] = [];
  for (const line of lines) (limit.bps === null || line.effective_discount_bps <= limit.bps ? accepted : rejected).push(line);
  return { accepted, rejected };
}
/**
 * يجمع الصوافي المقربة فقط ويمنع تجاوز numeric(14,3) للزيارة كلها.
 *
 * @param nets صوافي البنود القديمة والجديدة المقبولة
 * @returns الإجمالي بالفلس ضمن المجال المالي
 */
export function sessionTotal(nets: readonly bigint[]): bigint {
  try { for (const net of nets) lineNet(net, 0n); return sumMoney(nets); }
  catch { throw new SessionError('SESSION_TOTAL_TOO_LARGE'); }
}
/**
 * يحتسب الملغى ضمن سعة الزيارة ويخصص ترتيباً متصلاً للإضافات فقط.
 *
 * @param existingOrdinals ترتيبات كل البنود المحفوظة، بما فيها الملغاة
 * @param accepted عدد الإضافات المقبولة
 * @returns ترتيبات الإضافات المتصلة
 */
export function appendOrdinals(existingOrdinals: readonly number[], accepted: number): number[] {
  const maximum = Math.max(0,...existingOrdinals);
  if (existingOrdinals.some((ordinal) => !Number.isInteger(ordinal) || ordinal < 1 || ordinal > 20)
    || !Number.isInteger(accepted) || accepted < 1 || existingOrdinals.length + accepted > 20 || maximum + accepted > 20)
    throw new SessionError('SESSION_LINE_CAPACITY_EXCEEDED');
  return Array.from({ length: accepted }, (_, i) => maximum + i + 1);
}
