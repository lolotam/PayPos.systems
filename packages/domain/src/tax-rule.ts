import type { Percentage } from './percentage.js';

/**
 * طريقة احتساب الضريبة على السعر:
 * INCLUSIVE — السعر المعروض شامل الضريبة، والضريبة بتتطلع منه.
 * EXCLUSIVE — الضريبة بتتضاف فوق السعر المعروض.
 */
export type TaxMode = 'INCLUSIVE' | 'EXCLUSIVE';

/**
 * قاعدة ضريبة (VAT) لدولة معيّنة. الكويت مفيهاش VAT النهارده، فالشكل جاهز
 * من غير أي حساب ولا واجهة (D-27) — الحساب نفسه بييجي مع computeOrderTotals في P2-T4.
 * البيزنس اللي مفيهوش قاعدة ضريبة معناه إن مفيش ضريبة، مش rate = 0.
 */
export interface TaxRule {
  /** كود القاعدة الثابت اللي بيظهر على الفاتورة، زي "VAT-STANDARD". */
  readonly code: string;
  /** كود الدولة بصيغة ISO 3166-1 alpha-2، زي "KW" أو "SA". */
  readonly countryCode: string;
  /** نسبة الضريبة بوحدة 0.0001%. */
  readonly rate: Percentage;
  /** السعر شامل الضريبة ولا الضريبة فوقه. */
  readonly mode: TaxMode;
}
