import { sql } from 'drizzle-orm';
import { ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

const packageType = ids.newId();
const soldEntitlement = ids.newId();
const importedEntitlement = ids.newId();
const soldComponentOne = ids.newId();
const soldComponentTwo = ids.newId();
const importedComponent = ids.newId();
const importFile = ids.newId();
const importPreview = ids.newId();

/** ينشئ حقائق البيع والاستيراد الاصطناعية مع حراس التخزين كما هي.
 * @returns سياق المستأجر ومعرّفات الحقائق التي تقرؤها اختبارات التفاصيل
 */
export async function packageEntitlementDetailFixture() {
  const f = await sessionFixture();
  return seedEntitlementDetail(f).catch(async (error) => {
    throw await f.close().then(
      () => error,
      (cleanup) => new AggregateError([error, cleanup]),
    );
  });
}

async function seedEntitlementDetail(f: SessionFixture) {
  const employee = must(f.employees[0]);
  await f.db.withTenant(f.company, (tx) =>
    tx.execute(
      sql`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
        VALUES(${f.company},${packageType},${f.business},'Synthetic package type','50.000',90)`,
    ),
  );
  await seedImportPreview(f);
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`INSERT INTO package_entitlements
      (company_id,id,business_id,customer_id,package_type_id,provenance,name_en,name_ar,validity_days,list_price,price_paid,
        discount,discount_bps,paid_method,seller_employee_id,seller_linked_user_id,sold_branch_id,sold_at,sold_business_date,
        sold_timezone,recorded_by,recorded_by_membership_id,expires_on)
      VALUES(${f.company},${soldEntitlement},${f.business},${f.customer},${packageType},'SOLD','Sold package snapshot','باقة مباعة',
        90,'50.000','50.000','0.000',0,'CASH',${employee},${f.userId},${f.branch},'2026-10-20T09:30:00.123Z'::timestamptz,
        '2026-10-20'::date,'Asia/Kuwait',${f.userId},${f.membership},'2027-01-18'::date)`);
    await tx.execute(sql`INSERT INTO package_entitlements
      (company_id,id,business_id,customer_id,provenance,name_en,price_paid,recorded_by,recorded_by_membership_id,
        external_ref,import_batch_id,import_row,expires_on)
      VALUES(${f.company},${importedEntitlement},${f.business},${f.customer},'IMPORTED','Imported package','40.000',
        ${f.userId},${f.membership},'EXT-IMPORT-1',${importPreview},1,'2027-01-15'::date)`);
    await tx.execute(sql`INSERT INTO package_components
      (company_id,id,business_id,entitlement_id,service_id,position,name_en,name_ar,list_price_snapshot,sessions_total,component_value)
      VALUES(${f.company},${soldComponentOne},${f.business},${soldEntitlement},${must(f.services[0])},1,'Snapshot service one','لقطة أولى',
        '15.000',3,'30.000'),
        (${f.company},${soldComponentTwo},${f.business},${soldEntitlement},${must(f.services[1])},2,'Snapshot service two','لقطة تانية',
        '10.000',3,'20.000'),
        (${f.company},${importedComponent},${f.business},${importedEntitlement},${must(f.services[2])},1,'Snapshot imported service','لقطة مستوردة',
        '0.000',4,'40.000')`);
    await tx.execute(sql`INSERT INTO package_session_slots
      (company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
      VALUES(${f.company},${ids.newId()},${f.business},${soldEntitlement},${soldComponentOne},1,'10.000','FREE'),
        (${f.company},${ids.newId()},${f.business},${soldEntitlement},${soldComponentOne},2,'10.000','FREE'),
        (${f.company},${ids.newId()},${f.business},${soldEntitlement},${soldComponentOne},3,'10.000','FREE'),
        (${f.company},${ids.newId()},${f.business},${soldEntitlement},${soldComponentTwo},1,'6.666','FREE'),
        (${f.company},${ids.newId()},${f.business},${soldEntitlement},${soldComponentTwo},2,'6.666','FREE'),
        (${f.company},${ids.newId()},${f.business},${soldEntitlement},${soldComponentTwo},3,'6.668','FREE'),
        (${f.company},${ids.newId()},${f.business},${importedEntitlement},${importedComponent},1,'10.000','IMPORTED_USED'),
        (${f.company},${ids.newId()},${f.business},${importedEntitlement},${importedComponent},2,'10.000','IMPORTED_USED'),
        (${f.company},${ids.newId()},${f.business},${importedEntitlement},${importedComponent},3,'10.000','FREE'),
        (${f.company},${ids.newId()},${f.business},${importedEntitlement},${importedComponent},4,'10.000','FREE')`);
  });
  await seedBulkPackages(f, employee, packageType);
  await f.h.owner.unsafe('ANALYZE package_entitlements, package_components, package_session_slots');
  return {
    f,
    employee,
    packageType,
    soldEntitlement,
    importedEntitlement,
    soldComponentOne,
    soldComponentTwo,
  };
}

/** عبوات تانية محدودة عشان الفهرس يكون أحسن من المسح الكامل في خطة القراءة. */
async function seedBulkPackages(
  f: SessionFixture,
  employee: string,
  packageType: string,
): Promise<void> {
  const payload = JSON.stringify(
    Array.from({ length: 400 }, () => ({
      id: ids.newId(),
      component: ids.newId(),
      slot: ids.newId(),
    })),
  );
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`INSERT INTO package_entitlements
      (company_id,id,business_id,customer_id,package_type_id,provenance,name_en,validity_days,list_price,price_paid,discount,
        discount_bps,paid_method,seller_employee_id,sold_branch_id,sold_at,sold_business_date,sold_timezone,recorded_by,
        recorded_by_membership_id,expires_on)
      SELECT ${f.company}, r.id, ${f.business}, ${f.customer}, ${packageType}, 'SOLD', 'Bulk package', 30, 10.000, 10.000, 0.000, 0,
        'CASH', ${employee}, ${f.branch}, '2026-10-01T00:00:00Z'::timestamptz, '2026-10-01'::date, 'Asia/Kuwait', ${f.userId},
        ${f.membership}, '2026-12-31'::date
      FROM jsonb_to_recordset(${payload}::text::jsonb) r(id uuid)`);
    await tx.execute(sql`INSERT INTO package_components
      (company_id,id,business_id,entitlement_id,service_id,position,name_en,list_price_snapshot,sessions_total,component_value)
      SELECT ${f.company}, r.component, ${f.business}, r.id, ${must(f.services[3])}, 1, 'Bulk component', 10.000, 1, 10.000
      FROM jsonb_to_recordset(${payload}::text::jsonb) r(id uuid, component uuid)`);
    await tx.execute(sql`INSERT INTO package_session_slots
      (company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
      SELECT ${f.company}, r.slot, ${f.business}, r.id, r.component, 1, 10.000, 'FREE'
      FROM jsonb_to_recordset(${payload}::text::jsonb) r(id uuid, component uuid, slot uuid)`);
  });
}

async function seedImportPreview(f: SessionFixture): Promise<void> {
  // ملف الاستيراد ومعاينته: التريغر بتاع الاستحقاق بيتأكد إن الـ batch بتاع استيراد باقات لنفس النشاط.
  await f.h
    .owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,staging_key,
    content_type,size_bytes,required_permission,created_by,created_at)
    VALUES(${f.company},${importFile},${f.business},'import',${importFile},'synthetic-package-import','application/pdf',10,
    'read:files:business',${f.userId},now())`;
  await f.h
    .owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,created_at,
    expires_at,row_count,error_count,rows,errors)
    VALUES(${f.company},${importPreview},${f.business},'packages',${importFile},${f.userId},now(),now() + interval '1 day',1,0,
    '[]'::jsonb,'[]'::jsonb)`;
}
