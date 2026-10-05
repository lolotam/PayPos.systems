import { OWNER_ROLE_ID } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createDocumentTypeTransactions } from '../persistence/drizzle-document-types.ts';
import { createEmployeeDocumentTransactions } from '../persistence/drizzle-employee-documents.ts';
import { CreateDocumentTypeUseCase } from '../use-cases/create-document-type/create-document-type.usecase.ts';
import { RecordEmployeeDocumentUseCase } from '../use-cases/record-employee-document/record-employee-document.usecase.ts';
import { employeesFixture, grantEmployeeCreation, termsFor } from './employees.fixture.ts';

export const documentIds = systemUuidV7();
// 21:30 UTC هو اليوم التالي في الكويت؛ الشارة تستخدم يوم النشاط لا يوم UTC.
export const documentClock = { now: () => new Date('2026-10-04T21:30:00Z') };
export const KUWAIT_TODAY = '2026-10-05';

export async function documentsFixture() {
  const f = await employeesFixture();
  await grantEmployeeCreation(f);
  const command = { companyId: f.company, userId: f.userId, businessId: f.business };
  const employee = await f.useCase.execute({ ...command, input: termsFor(f) });
  const other = await f.useCase.execute({ ...command, input: termsFor(f, 'Synthetic second') });
  await f.h.owner`UPDATE memberships SET role_id=${OWNER_ROLE_ID},role_owner_key='global'
    WHERE company_id=${f.company} AND id=${f.memberId}`;
  for (const [company, code, required] of [
    [f.company, 'civil_id', true],
    [f.company, 'work_contract', false],
    [f.company, 'passport', true],
    [f.otherCompany, 'civil_id', true],
  ] as const)
    await f.h
      .owner`INSERT INTO document_types(company_id,id,code,name_en,alert_days,requires_expiry)
      VALUES (${company},${documentIds.newId()},${code},${`Synthetic ${code}`},30,${required})`;
  const record = new RecordEmployeeDocumentUseCase(
    createEmployeeDocumentTransactions(f.db, documentIds),
    documentIds,
    documentClock,
  );
  const createType = new CreateDocumentTypeUseCase(
    createDocumentTypeTransactions(f.db, documentIds),
    documentIds,
  );
  return {
    ...f,
    employee,
    other,
    record,
    createType,
    path: `/v1/businesses/${f.business}/employees/${employee.id}/documents`,
  };
}
export type DocumentsFixture = Awaited<ReturnType<typeof documentsFixture>>;

export async function documentFile(
  f: DocumentsFixture,
  patch: {
    company?: string;
    business?: string;
    entity?: string;
    module?: string;
    permission?: string;
    createdBy?: string;
    contentType?: string;
    status?: 'PENDING' | 'READY';
  } = {},
) {
  const id = documentIds.newId();
  const company = patch.company ?? f.company;
  const business = patch.business ?? f.business;
  const ready = (patch.status ?? 'READY') === 'READY';
  await f.h
    .owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,staging_key,storage_key,
    content_type,size_bytes,required_permission,created_by,created_at,status)
    VALUES (${company},${id},${business},${patch.module ?? 'staff'},${patch.entity ?? f.employee.id},
      ${`${company}/${business}/${id}/staging`},${ready ? `${company}/${business}/${id}/verified` : null},
      ${patch.contentType ?? 'application/pdf'},10,${patch.permission ?? 'read:files:business'},${patch.createdBy ?? f.userId},
      '2026-10-04T08:00:00Z',${patch.status ?? 'READY'})`;
  return id;
}

export const recordCommand = (
  f: DocumentsFixture,
  fileId: string,
  input: { type_code?: string; expires_on?: string | null } = {},
  employeeId = f.employee.id,
) => ({
  companyId: f.company,
  userId: f.userId,
  businessId: f.business,
  employeeId,
  key: documentIds.newId(),
  fingerprint: 'b'.repeat(64),
  input: {
    type_code: input.type_code ?? 'civil_id',
    file_id: fileId,
    expires_on: input.expires_on === undefined ? '2026-10-20' : input.expires_on,
  },
});
