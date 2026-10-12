import type postgres from 'postgres';
import { OWNER_ROLE_ID } from '../src/access-catalog.ts';
import { TENANT, USER } from './tenancy-fixtures.ts';

export const ORDER_IDS = { membership: '01920000-0000-7000-8000-000000004001', customer: '01920000-0000-7000-8000-000000004002',
  service: '01920000-0000-7000-8000-000000004003', employee: '01920000-0000-7000-8000-000000004004',
  session: '01920000-0000-7000-8000-000000004005', line: '01920000-0000-7000-8000-000000004006', performer: '01920000-0000-7000-8000-000000004007' };
export async function seedOrders(owner: postgres.Sql) {
  await owner`INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at)
    VALUES(${USER},'Synthetic recorder','orders-fixture@example.test',true,now(),now()) ON CONFLICT DO NOTHING`;
  for (const t of Object.values(TENANT)) {
    await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
      VALUES(${t.company},${ORDER_IDS.membership},${USER},${OWNER_ROLE_ID},'global','COMPANY',${t.company})`;
    await owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
      VALUES(${t.company},${ORDER_IDS.customer},'Synthetic customer','+999999998123','en',now(),now())`;
    await owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
      VALUES(${t.company},${ORDER_IDS.service},${t.business},'Synthetic service',1.000,'ZERO')`;
    await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
      VALUES(${t.company},${ORDER_IDS.employee},${t.business},${t.branch},'Synthetic performer','synthetic performer','staff','2026-01-01')`;
    await owner.begin(async (tx) => {
      await tx`INSERT INTO service_sessions(company_id,id,business_id,branch_id,customer_id,customer_name,customer_phone_masked,
        recorded_by,recorded_by_membership_id,occurred_at,recorded_at,business_date,business_timezone,late)
        VALUES(${t.company},${ORDER_IDS.session},${t.business},${t.branch},${ORDER_IDS.customer},'Synthetic customer','***123',${USER},${ORDER_IDS.membership},now(),now(),current_date,'Asia/Kuwait',false)`;
      await tx`INSERT INTO service_lines(company_id,id,business_id,session_id,service_id,ordinal,input_index,status,revision,list_price,price,discount,net,
        effective_discount_bps,limit_source,limit_bps_applied,name_en,catalog_revision,rule_kind,counts_toward_threshold,has_performer_warning,recorded_by,recorded_by_membership_id,recorded_at,late)
        VALUES(${t.company},${ORDER_IDS.line},${t.business},${ORDER_IDS.session},${ORDER_IDS.service},1,0,'ACTIVE',1,1.000,1.000,0.000,1.000,0,'OWNER',NULL,
          'Synthetic service',1,'ZERO',true,false,${USER},${ORDER_IDS.membership},now(),false)`;
      await tx`INSERT INTO line_performers(company_id,id,business_id,line_id,employee_id,performer_ordinal,share_bps,name_en,not_clocked_in_warning,approved_leave_warning)
        VALUES(${t.company},${ORDER_IDS.performer},${t.business},${ORDER_IDS.line},${ORDER_IDS.employee},1,10000,'Synthetic performer',false,false)`;
    });
  }
}
