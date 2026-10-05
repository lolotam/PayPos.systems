import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';

import { startHarness } from '../../../../test/harness.ts';
import { serviceDetail } from '../queries/service-detail.query.ts';
import { createServiceTransactions } from '../persistence/drizzle-service-transactions.ts';
import { CreateServiceUseCase } from '../use-cases/create-service/create-service.usecase.ts';
import { UpdateServiceUseCase } from '../use-cases/update-service/update-service.usecase.ts';

const ids = systemUuidV7();
const AT = new Date('2026-10-05T10:00:00Z');

export async function servicesFixture() {
  const h = await startHarness();
  const ownerCookie = await h.signedInOperator('service-owner@example.test');
  const cookie = await h.signedInOperator('service-manager@example.test');
  const company = await h.onboard(ownerCookie, 'Synthetic service employer');
  const otherCompany = await h.onboard(cookie, 'Synthetic service other employer');
  const [holder] = await h.owner`SELECT id FROM "user" WHERE email='service-manager@example.test'`;
  const userId = holder?.['id'] as string;
  const memberId = ids.newId();
  const role = ids.newId();
  await h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${role},${company},'synthetic_service_editor','Synthetic service editor')`;
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${company},${memberId},${userId},${role},${company},'COMPANY',${company})`;
  const business = ids.newId();
  const secondBusiness = ids.newId();
  const foreignBusiness = ids.newId();
  for (const [co, bu] of [
    [company, business],
    [company, secondBusiness],
    [otherCompany, foreignBusiness],
  ]) {
    await h.owner`INSERT INTO businesses (company_id,id,name_en,vertical_type)
      VALUES (${co as string},${bu as string},'Synthetic business','salon')`;
  }
  const db = createDatabase({ url: h.urls.app, ids });
  const transactions = createServiceTransactions(db, ids);
  const clock = { now: () => AT };
  return {
    h,
    cookie,
    company,
    otherCompany,
    userId,
    memberId,
    business,
    secondBusiness,
    foreignBusiness,
    db,
    transactions,
    create: new CreateServiceUseCase(transactions, ids, clock),
    update: new UpdateServiceUseCase(transactions, clock),
  };
}

export type ServiceFixture = Awaited<ReturnType<typeof servicesFixture>>;

export const termsFor = (name = 'Synthetic service') => ({
  name_en: name,
  price: '12.500',
  commission_rule: { kind: 'FOLLOW_PLAN' as const },
  counts_toward_threshold: true,
});

export async function grantServices(
  f: ServiceFixture,
  business = f.business,
  permission: 'manage:services:business' | 'read:services:business' = 'manage:services:business',
) {
  await f.h
    .owner`INSERT INTO permission_overrides (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${f.company},${ids.newId()},${f.memberId},${permission},'ALLOW','BUSINESS',${business},'Synthetic grant',${f.userId})`;
}

/** يحمل الخدمة عبر مسار القراءة كما تفعل الشاشة، لفحص العزل والنطاق. */
export function detailFor(
  f: ServiceFixture,
  companyId: string,
  businessId: string,
  serviceId: string,
) {
  return f.db.withTenant(companyId, (tx) => serviceDetail(tx, companyId, businessId, serviceId));
}
