import type { Tx } from '@pospay/db';
import { packageSalePlace } from '../../tenancy/index.ts';
import type { PackageSalePlacePort } from '../ports/package-sale-transactions.port.ts';

/**
 * مكان بيع الباقة مقروء من معاملة البيع نفسها؛ التوقيت بيتقرأ من الفرع مع الرجوع للنشاط.
 *
 * @param tx معاملة بيع الباقة
 * @param companyId الشركة المؤكدة
 * @param businessId النشاط المطلوب
 * @param branchId فرع البيع
 * @returns قارئ المكان؛ null لما الفرع مش تابع للشركة أو متوقف
 */
export function packageSalePlaceAdapter(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
): PackageSalePlacePort {
  return {
    read: async () => {
      const timezone = await packageSalePlace(tx, companyId, businessId, branchId);
      return timezone === null ? null : { timezone };
    },
  };
}
