import {
  appendAuditLog,
  appendOutboxEvent,
  runIdempotent,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';
import { DocumentError, type DocumentTypeRecord } from '../domain/document-types.ts';
import type { EmployeeDocumentRecord } from '../domain/employee-documents.ts';
import type {
  EmployeeDocumentContext,
  EmployeeDocumentScope,
  EmployeeDocumentTransactions,
} from '../ports/employee-documents.port.ts';
import { documentAccess, documentAccessLock, documentTimeZone } from './document-access.adapter.ts';
import { documentFailure } from './document-failures.ts';
import { readDocumentFile } from './document-files.adapter.ts';

const OPERATION = 'record-employee-document';
const iso = (column: string) =>
  sql.raw(`to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

async function authorize(tx: Tx, c: EmployeeDocumentContext): Promise<string> {
  if (!(await documentAccessLock(tx, c.companyId))) throw new DocumentError('NOT_FOUND');
  const [employee] = await tx.execute(
    sql`SELECT id FROM employees WHERE company_id=${c.companyId} AND business_id=${c.businessId} AND id=${c.employeeId} AND deleted_at IS NULL FOR UPDATE`,
  );
  if (employee === undefined) throw new DocumentError('NOT_FOUND');
  const access = await documentAccess(tx, c.companyId, c.userId, c.businessId);
  if (!access.manage) throw new DocumentError('NOT_FOUND');
  if (!access.featureEnabled) throw new DocumentError('FEATURE_DISABLED');
  return documentTimeZone(tx, c.companyId, c.businessId);
}

// السجل والحدث لا يحملان مفتاح الملف: المفاتيح لا تدخل التدقيق أو الطوابير (ADR-0022).
const snapshot = (d: EmployeeDocumentRecord) => ({
  id: d.id,
  business_id: d.business_id,
  employee_id: d.employee_id,
  type_code: d.type_code,
  expires_on: d.expires_on,
  uploaded_by: d.uploaded_by,
  recorded_at: d.recorded_at,
  replaced_at: d.replaced_at,
});

async function save(
  tx: Tx,
  c: EmployeeDocumentContext,
  ids: IdGenerator,
  replaced: EmployeeDocumentRecord | null,
  d: EmployeeDocumentRecord,
) {
  if (replaced !== null)
    await tx.execute(sql`UPDATE employee_documents SET replaced_at=GREATEST(recorded_at, ${d.recorded_at}::timestamptz)
      WHERE company_id=${c.companyId} AND id=${replaced.id} AND replaced_at IS NULL`);
  await tx.execute(sql`INSERT INTO employee_documents(company_id, id, business_id, employee_id, type_code, object_key, expires_on, uploaded_by, recorded_at)
    VALUES (${c.companyId}, ${d.id}, ${d.business_id}, ${d.employee_id}, ${d.type_code}, ${d.object_key}, ${d.expires_on}::date, ${d.uploaded_by}, ${d.recorded_at}::timestamptz)`);
  await appendAuditLog(tx, ids.newId(), {
    entity: 'employee_document',
    entityId: d.id,
    action: 'employee_document.record',
    before: replaced === null ? null : snapshot(replaced),
    after: snapshot(d),
  });
  await appendOutboxEvent(tx, ids.newId(), {
    aggregateType: 'employee',
    aggregateId: d.employee_id,
    eventType: 'EmployeeDocumentRecorded',
    payload: {
      document_id: d.id,
      employee_id: d.employee_id,
      business_id: d.business_id,
      type_code: d.type_code,
      expires_on: d.expires_on,
      replaced_document_id: replaced?.id ?? null,
      recorded_at: d.recorded_at,
    },
  });
}

function scope(
  tx: Tx,
  c: EmployeeDocumentContext,
  ids: IdGenerator,
  timeZone: string,
): EmployeeDocumentScope {
  return {
    timeZone,
    file: (fileId) => readDocumentFile(tx, c.companyId, fileId),
    type: async (code) => {
      const [row] =
        await tx.execute<DocumentTypeRecord>(sql`SELECT id, code, name_en, name_ar, alert_days, requires_expiry, active, revision
        FROM document_types WHERE company_id=${c.companyId} AND code=${code}`);
      return row ?? null;
    },
    recorded: async (objectKey) =>
      (
        await tx.execute(
          sql`SELECT 1 FROM employee_documents WHERE company_id=${c.companyId} AND object_key=${objectKey}`,
        )
      ).length > 0,
    current: async (typeCode) => {
      const [row] =
        await tx.execute<EmployeeDocumentRecord>(sql`SELECT id, business_id, employee_id, type_code, object_key,
        to_char(expires_on,'YYYY-MM-DD') AS expires_on, uploaded_by, ${iso('recorded_at')} AS recorded_at, NULL AS replaced_at
        FROM employee_documents WHERE company_id=${c.companyId} AND employee_id=${c.employeeId} AND type_code=${typeCode}
        AND replaced_at IS NULL FOR UPDATE`);
      return row ?? null;
    },
    save: (replaced, recorded) => save(tx, c, ids, replaced, recorded),
  };
}

export function createEmployeeDocumentTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
): EmployeeDocumentTransactions {
  return {
    run: async (context, work) => {
      try {
        return await database.withTenant(
          context.companyId,
          async (tx) => {
            const timeZone = await authorize(tx, context);
            const request = { key: context.key, fingerprint: context.fingerprint };
            const result = await runIdempotent(
              tx,
              { scope: 'COMPANY', operation: OPERATION, ...request },
              async () => ({ status: 200, body: await work(scope(tx, context, ids, timeZone)) }),
            );
            return result.body as Awaited<ReturnType<typeof work>>;
          },
          { userId: context.userId },
        );
      } catch (error) {
        throw documentFailure(error, OPERATION);
      }
    },
  };
}
