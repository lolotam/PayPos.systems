import { AT, ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

/** سعر الباقة بالدينار؛ الخدمة الأولى ٢٥٫٠٠٠ والثانية ٧٫١٢٥. */
export const LIST_PRICE = '30.000';
export const FIRST_SESSIONS = 4;
export const SECOND_SESSIONS = 2;
export const VALIDITY_DAYS = 90;

/** باقة على فرع بيع في شركة واحدة، مع خدمة أولى وأخرى؛ الأرقام متوقعة في الاختبارات. */
export interface PackageSaleFixture extends SessionFixture {
  readonly packageType: string;
  readonly firstService: string;
  readonly secondService: string;
  readonly saleInput: (overrides?: {
    pricePaid?: string;
    packageTypeId?: string;
    typeRevision?: number;
    serviceRevision?: number;
    sellerEmployeeId?: string;
    customerId?: string;
  }) => Record<string, unknown>;
}

export async function packageSaleFixture(): Promise<PackageSaleFixture> {
  const f = await sessionFixture({ ordersClock: { now: () => f?.clock.now() ?? AT } });
  const packageType = ids.newId();
  const firstService = must(f.services[0]);
  const secondService = must(f.services[1]);
  await f.h.owner`INSERT INTO package_types(company_id,id,business_id,name_en,name_ar,price,validity_days)
    VALUES(${f.company},${packageType},${f.business},'Synthetic sale package','باقة البيع',${LIST_PRICE},${VALIDITY_DAYS})`;
  await f.h.owner`INSERT INTO package_type_components(company_id,id,package_type_id,business_id,service_id,sessions,position)
    VALUES(${f.company},${ids.newId()},${packageType},${f.business},${firstService},${FIRST_SESSIONS},1),
      (${f.company},${ids.newId()},${packageType},${f.business},${secondService},${SECOND_SESSIONS},2)`;
  const saleInput = (overrides: {
    pricePaid?: string;
    packageTypeId?: string;
    typeRevision?: number;
    serviceRevision?: number;
    sellerEmployeeId?: string;
    customerId?: string;
  } = {}) => ({
    customer_id: overrides.customerId ?? f.customer,
    package_type_id: overrides.packageTypeId ?? packageType,
    expected_type_revision: overrides.typeRevision ?? 1,
    expected_service_revisions: [
      { service_id: firstService, revision: overrides.serviceRevision ?? 1 },
      { service_id: secondService, revision: overrides.serviceRevision ?? 1 },
    ],
    price_paid: overrides.pricePaid ?? LIST_PRICE,
    paid_method: 'CASH',
    seller_employee_id: overrides.sellerEmployeeId ?? must(f.employees[0]),
  });
  return { ...f, packageType, firstService, secondService, saleInput };
}
