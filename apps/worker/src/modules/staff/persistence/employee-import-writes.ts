import { appendAuditLogs, appendOutboxEvents, type IdGenerator, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { ImportedEmployeeRecord } from '../domain/employee-import.ts';

function employeeAuditSnapshot(record: ImportedEmployeeRecord) {
  return {
    id: record.id,
    business_id: record.business_id,
    primary_branch_id: record.primary_branch_id,
    name_en: record.name_en,
    name_ar: record.name_ar,
    role_code: record.role_code,
    hire_date: record.hire_date,
    contract_end: record.contract_end,
    user_id: record.user_id,
    created_at: record.created_at,
  };
}

export async function insertEmployees(
  tx: Tx,
  companyId: string,
  ids: IdGenerator,
  records: readonly ImportedEmployeeRecord[],
): Promise<void> {
  if (records.length === 0) return;
  const employees = records.map(
    (r) =>
      sql`(${companyId},${r.id},${r.business_id},${r.primary_branch_id},${r.user_id},${r.name_ar},${r.name_en},${r.name_ar_key ?? null},${r.name_en_key ?? null},${r.role_code},${r.hire_date},${r.contract_end},${r.created_at})`,
  );
  await tx.execute(sql`INSERT INTO employees (company_id,id,business_id,primary_branch_id,user_id,name_ar,name_en,name_ar_key,name_en_key,role_code,hire_date,contract_end,created_at)
    VALUES ${sql.join(employees, sql`,`)}`);
  const attachments = records.map(
    (r) =>
      sql`(${companyId},${ids.newId()},${r.business_id},${r.id},${r.primary_branch_id},${r.hire_date})`,
  );
  await tx.execute(sql`INSERT INTO employee_branches (company_id,id,business_id,employee_id,branch_id,"from")
    VALUES ${sql.join(attachments, sql`,`)}`);
  await appendAuditLogs(
    tx,
    records.map((record) => ({
      id: ids.newId(),
      entry: {
        entity: 'employee',
        entityId: record.id,
        action: 'imported',
        after: employeeAuditSnapshot(record),
      },
    })),
  );
  await appendOutboxEvents(
    tx,
    records.map((record) => ({
      id: ids.newId(),
      event: {
        aggregateType: 'employee',
        aggregateId: record.id,
        eventType: 'EmployeeImported',
        payload: {
          employee_id: record.id,
          business_id: record.business_id,
          primary_branch_id: record.primary_branch_id,
          name_en: record.name_en,
          name_ar: record.name_ar,
          role_code: record.role_code,
          hire_date: record.hire_date,
          contract_end: record.contract_end,
          created_at: record.created_at,
        },
      },
    })),
  );
}
