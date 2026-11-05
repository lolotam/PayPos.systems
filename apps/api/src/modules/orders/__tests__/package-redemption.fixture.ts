import { sql } from 'drizzle-orm';
import { moneyToString } from '@pospay/domain';
import { ids, must, type SessionFixture } from './session.fixture.ts';

export interface PackageSeed {
  entitlement: string;
  component: string;
}

/** سطر من الباقة: الاستحقاق باسمه مع خدمته، من غير سعر ولا خصم. */
export function packageLine(f: SessionFixture, entitlementId: string, service = must(f.services[0]), employee = must(f.employees[0])) {
  return { service_id: service, package: { entitlement_id: entitlementId }, performers: [{ employee_id: employee }] };
}

/**
 * يبني استحقاقاً بمكوّن واحد وجلسات قيمتها واحدة لكل جلسة، ومال الباقة مساوي لمجموع الجلسات.
 * والاستيراد بلا وقت بيع، والبيع له وقت بيع لو حدّدت soldAt.
 */
export async function seedPackage(f: SessionFixture, options: {
  sessions: number;
  expiresOn: string;
  used?: number;
  customerId?: string;
  businessId?: string;
  serviceId?: string;
  soldAt?: Date | null;
  unit?: string;
}): Promise<PackageSeed> {
  const companyId = f.company;
  const businessId = options.businessId ?? f.business;
  const customerId = options.customerId ?? f.customer;
  const entitlement = ids.newId();
  const component = ids.newId();
  const total = options.sessions;
  const used = options.used ?? 0;
  const serviceId = options.serviceId ?? must(f.services[0]);
  const unit = options.unit ?? moneyToString(1000n);
  const value = moneyToString(BigInt(total) * BigInt(unit.replace('.', '')));
  if (options.soldAt) {
    const type = ids.newId();
    await f.h.owner`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
      VALUES(${companyId},${type},${businessId},'Synthetic package type',${value},30)`;
    await f.db.withTenant(companyId, async (tx) => {
      await tx.execute(sql`INSERT INTO package_entitlements(company_id,id,business_id,customer_id,provenance,package_type_id,
        name_en,validity_days,list_price,price_paid,discount,discount_bps,paid_method,seller_employee_id,sold_branch_id,sold_at,
        sold_business_date,sold_timezone,recorded_by,recorded_by_membership_id,expires_on)
        VALUES(${companyId},${entitlement},${businessId},${customerId},'SOLD',${type},'Synthetic package',30,${value},${value},0,0,
        'CASH',${must(f.employees[0])},${f.branch},${must(options.soldAt).toISOString()},'2026-10-20','Asia/Kuwait',${f.userId},${f.membership},${options.expiresOn})`);
      await seedComponent(tx, { companyId, businessId, entitlement, component, total, used, unit, value, serviceId });
    });
    return { entitlement, component };
  }
  const file = ids.newId();
  const preview = ids.newId();
  await f.h.owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,
    staging_key,content_type,size_bytes,required_permission,created_by,created_at)
    VALUES(${companyId},${file},${businessId},'import',${file},${file},'application/pdf',10,'read:files:business',${f.userId},now())`;
  await f.h.owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,
    created_at,expires_at,row_count,error_count,rows,errors)
    VALUES(${companyId},${preview},${businessId},'packages',${file},${f.userId},now(),now()+interval '1 day',1,0,'[]'::jsonb,'[]'::jsonb)`;
  await f.db.withTenant(companyId, async (tx) => {
    await tx.execute(sql`INSERT INTO package_entitlements(company_id,id,business_id,customer_id,provenance,name_en,
      price_paid,recorded_by,recorded_by_membership_id,external_ref,import_batch_id,import_row,expires_on)
      VALUES(${companyId},${entitlement},${businessId},${customerId},'IMPORTED','Synthetic package',${value},${f.userId},
      ${f.membership},${entitlement},${preview},1,${options.expiresOn})`);
    await seedComponent(tx, { companyId, businessId, entitlement, component, total, used, unit, value, serviceId });
  });
  return { entitlement, component };
}

/** المكوّن وجلساته في نفس معاملة الاستحقاق، فختم الإنشاء يبقى صحيحاً. */
async function seedComponent(
  tx: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> },
  options: { companyId: string; businessId: string; entitlement: string; component: string; total: number; used: number; unit: string; value: string; serviceId: string },
): Promise<void> {
  await tx.execute(sql`INSERT INTO package_components(company_id,id,business_id,entitlement_id,service_id,position,name_en,
    list_price_snapshot,sessions_total,component_value)
    VALUES(${options.companyId},${options.component},${options.businessId},${options.entitlement},${options.serviceId},1,
    'Synthetic component',${options.unit},${options.total},${options.value})`);
  await tx.execute(sql`INSERT INTO package_session_slots(company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
    SELECT ${options.companyId}::uuid, gen_random_uuid(), ${options.businessId}::uuid, ${options.entitlement}::uuid,
    ${options.component}::uuid, n, ${options.unit},
    CASE WHEN n <= ${options.used} THEN 'IMPORTED_USED' ELSE 'FREE' END
    FROM generate_series(1, ${options.total}) n`);
}
