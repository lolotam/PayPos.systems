import type { NewCompany, Transaction } from './onboarding.port.ts';

/**
 * تسجيل الشركة — identity هو اللي بيعرّف الـ port ده (module-map.md §3) والـ adapter بينادي registerCompany بتاع
 * tenancy. ده الـ write المتزامن الوحيد بين modules (ADR-0003 §5.3): شركة من غير owner متتشافش أبداً.
 */
export interface CompanyRegistry {
  /**
   * بيضيف صف الشركة جوه transaction الـ onboarding ويرجّع وقت الإنشاء (ISO زي ما Postgres كتبه).
   *
   * @param tx      transaction الـ onboarding
   * @param company الشركة الجديدة
   */
  register(tx: Transaction, company: NewCompany): Promise<{ createdAt: string }>;
}
