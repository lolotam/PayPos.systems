import { documentBytesKey, documentStatusKey } from '@pospay/contracts';

import { defaultHoursFixture } from './employee-default-shifts.fixture.ts';
import { salaryIds } from './salary.fixture.ts';

export async function attendanceStatementApiFixture() {
  const f = await defaultHoursFixture();
  const [owner] = await f.h.owner`SELECT id FROM "user" WHERE email='employee-owner@example.test'`;
  const sameBusinessBranch = salaryIds.newId();
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES(${f.company},${sameBusinessBranch},${f.business},'Synthetic statement branch')`;
  return { ...f, otherUserId: owner?.['id'] as string, sameBusinessBranch };
}
export type AttendanceStatementApiFixture = Awaited<
  ReturnType<typeof attendanceStatementApiFixture>
>;

export interface StatementRequestSeed {
  id?: string;
  businessId?: string;
  branchId?: string;
  requestedBy?: string;
}

/** صف طلب بيان في مستأجر fixture؛ الطلب بيتثبت مرة واحدة وما بيتعدّلش. */
export async function seedStatementRequest(
  f: AttendanceStatementApiFixture,
  seed: StatementRequestSeed = {},
) {
  const id = seed.id ?? salaryIds.newId();
  await f.h
    .owner`INSERT INTO attendance_statement_requests(company_id,id,business_id,branch_id,form,employee_id,
      period_from,period_to,language,shift_start,shift_end,logo_file_id,requested_by,requested_at)
    VALUES(${f.company},${id},${seed.businessId ?? f.business},${seed.branchId ?? f.branch},'BRANCH',null,
      '2026-10-01','2026-10-31','ar',null,null,null,${seed.requestedBy ?? f.userId},'2026-10-23T07:00:00Z')`;
  return id;
}

export interface StatementStatusSeed {
  state?: string;
  requestedBy?: string;
  errorCode?: string;
  mimeType?: string;
}

/** هاش حالة المستند في Redis؛ نفس الشكل اللي الـ API والـ worker بيكتبوه. */
export async function seedStatusHash(
  f: AttendanceStatementApiFixture,
  renderId: string,
  seed: StatementStatusSeed = {},
) {
  const hash: Record<string, string> = {
    state: seed.state ?? 'QUEUED',
    requested_by: seed.requestedBy ?? f.userId,
    filename: 'attendance-statement-branch-2026-10-01_2026-10-31.pdf',
  };
  if (seed.errorCode !== undefined) hash['error_code'] = seed.errorCode;
  if (seed.mimeType !== undefined) hash['mime_type'] = seed.mimeType;
  await f.h.redis.hset(documentStatusKey(f.company, renderId), hash);
}

/** بايتات المستند في Redis؛ من غيرها الحالة READY بتقرأ منتهية. */
export async function seedDocumentBytes(f: AttendanceStatementApiFixture, renderId: string) {
  await f.h.redis.set(documentBytesKey(f.company, renderId), 'synthetic-pdf-bytes');
}
