import type { AttendanceStatementRequest, ScheduleShift } from '@pospay/contracts';
import { documentStatusKey, DOCUMENT_STATUS_TTL_SECONDS } from '@pospay/contracts';
import type { Redis } from 'ioredis';
import { vi } from 'vitest';

import type { StatementRenderJob } from '../ports/attendance-statement.port.ts';
import type * as StaffModule from '../staff.module.ts';
import {
  ATTENDANCE_STATEMENT_CLOCK,
  ATTENDANCE_STATEMENT_TRANSPORT,
} from '../staff-statement.providers.ts';
import {
  attendanceStatementApiFixture,
  type AttendanceStatementApiFixture,
} from './attendance-statement-api.fixture.ts';
import { salmiyaDefaults } from './employee-default-shifts.fixture.ts';
import { salaryIds } from './salary.fixture.ts';

const control = vi.hoisted(() => ({
  now: new Date('2026-10-23T07:00:00.000Z'),
  alive: true,
  failQueue: false,
  queued: [] as unknown[],
  failed: [] as string[],
  redis: null as Redis | null,
}));

vi.mock('../staff.module.ts', async (original) => {
  const real = await original<typeof StaffModule>();
  const transport = {
    rendererAlive: async () => control.alive,
    queue: async (job: StatementRenderJob) => {
      if (control.failQueue) throw new Error('queue unavailable');
      const key = documentStatusKey(job.companyId, job.renderId);
      await control.redis
        ?.multi()
        .hset(key, 'state', 'QUEUED', 'requested_by', job.requestedBy, 'filename', job.filename)
        .expire(key, DOCUMENT_STATUS_TTL_SECONDS)
        .exec();
      control.queued.push(job);
    },
    markFailed: async (companyId: string, renderId: string) => {
      const key = documentStatusKey(companyId, renderId);
      await control.redis
        ?.multi()
        .hset(key, 'state', 'FAILED', 'error_code', 'DOCUMENT_RENDER_FAILED')
        .expire(key, DOCUMENT_STATUS_TTL_SECONDS)
        .exec();
      control.failed.push(renderId);
    },
  };
  return {
    ...real,
    staffProviders: (...args: Parameters<typeof real.staffProviders>) =>
      real.staffProviders(...args).map((provider) => {
        if (typeof provider !== 'object' || !('provide' in provider)) return provider;
        if (provider.provide === ATTENDANCE_STATEMENT_CLOCK)
          return { provide: ATTENDANCE_STATEMENT_CLOCK, useValue: { now: () => control.now } };
        if (provider.provide === ATTENDANCE_STATEMENT_TRANSPORT)
          return { provide: ATTENDANCE_STATEMENT_TRANSPORT, useValue: transport };
        return provider;
      }),
  };
});

export async function attendanceStatementHttpFixture() {
  const f = await attendanceStatementApiFixture();
  await seedDefaultHours(f, f.employee.id, salmiyaDefaults);
  control.redis = f.h.redis;
  control.now = new Date('2026-10-23T07:00:00.000Z');
  control.alive = true;
  control.failQueue = false;
  control.queued = [];
  control.failed = [];
  const otherBusiness = salaryIds.newId();
  const otherBusinessBranch = salaryIds.newId();
  await f.h.owner`INSERT INTO businesses(company_id,id,name_en,vertical_type)
    VALUES(${f.company},${otherBusiness},'Synthetic statement business','salon')`;
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES(${f.company},${otherBusinessBranch},${otherBusiness},'Synthetic statement branch two')`;
  const logo = await seedLogoBusiness(f);
  const reader = await seedReaderWithoutPermission(f);
  return { ...f, ...logo, ...reader, otherBusiness, otherBusinessBranch, control };
}
export type AttendanceStatementHttpFixture = Awaited<
  ReturnType<typeof attendanceStatementHttpFixture>
>;

async function seedLogoBusiness(f: Awaited<ReturnType<typeof attendanceStatementApiFixture>>) {
  const logoBusiness = salaryIds.newId();
  const logoBranch = salaryIds.newId();
  const logoFileId = salaryIds.newId();
  await f.h.owner`INSERT INTO businesses(company_id,id,name_en,vertical_type)
    VALUES(${f.company},${logoBusiness},'Synthetic logo business','salon')`;
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES(${f.company},${logoBranch},${logoBusiness},'Synthetic logo branch')`;
  await f.h
    .owner`INSERT INTO file_objects(company_id,id,business_id,branch_id,owner_module,owner_entity_id,
      staging_key,storage_key,content_type,size_bytes,required_permission,created_by,created_at,status)
    VALUES(${f.company},${logoFileId},${logoBusiness},null,'settings',${logoBusiness},${`staging-${logoFileId}`},
      ${`storage-${logoFileId}`},'image/png',10,'manage:business-identity:business',${f.userId},now(),'READY')`;
  await f.h.owner`INSERT INTO business_settings(company_id,business_id,logo_file_id)
    VALUES(${f.company},${logoBusiness},${logoFileId})`;
  return { logoBusiness, logoBranch, logoFileId };
}

async function seedReaderWithoutPermission(
  f: Awaited<ReturnType<typeof attendanceStatementApiFixture>>,
) {
  const cookie = await f.h.signedInOperator('statement-reader@example.test');
  const [reader] = await f.h
    .owner`SELECT id FROM "user" WHERE email='statement-reader@example.test'`;
  const role = salaryIds.newId();
  await f.h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES(${role},${f.company},'synthetic_statement_reader','Synthetic statement reader')`;
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES(${f.company},${salaryIds.newId()},${reader?.['id'] as string},${role},${f.company},'COMPANY',${f.company})`;
  return { readerCookie: cookie, readerId: reader?.['id'] as string };
}

export function statementBody(
  patch: Partial<AttendanceStatementRequest> = {},
): Record<string, unknown> {
  return { form: 'BRANCH', from: '2026-10-01', to: '2026-10-31', language: 'ar', ...patch };
}

export interface StatementRequestOptions {
  branchId?: string;
  businessId?: string;
  cookie?: string;
}

export function sendStatementRequest(
  f: AttendanceStatementHttpFixture,
  body: unknown,
  options: StatementRequestOptions = {},
) {
  const businessId = options.businessId ?? f.business;
  const branchId = options.branchId ?? f.branch;
  return f.h.send(
    'POST',
    `/v1/businesses/${businessId}/branches/${branchId}/attendance-statements`,
    { cookie: options.cookie ?? f.cookie, company: f.company, body: body as object },
  );
}

export function statementRows(f: AttendanceStatementHttpFixture) {
  return f.h.owner`SELECT id, business_id, branch_id, form, employee_id,
    period_from::text AS period_from, period_to::text AS period_to, language,
    shift_start, shift_end, logo_file_id, requested_by, requested_at
    FROM attendance_statement_requests WHERE company_id = ${f.company} ORDER BY requested_at, id`;
}

export function rateKey(f: AttendanceStatementHttpFixture, userId = f.userId): string {
  return `rate:attendance-statement:${f.company}:${userId}`;
}

/**
 * يرجّع كل اختبار لنقطة الصفر: صفوف الطلبات بتتراكم في نفس الشركة، وعدّاد حد الطلبات في Redis بيزيد.
 */
export async function resetStatementHttp(f: AttendanceStatementHttpFixture): Promise<void> {
  await f.h.owner`DELETE FROM attendance_statement_requests WHERE company_id = ${f.company}`;
  await f.h.redis.del(rateKey(f));
  control.now = new Date('2026-10-23T07:00:00.000Z');
  control.alive = true;
  control.failQueue = false;
  control.queued = [];
  control.failed = [];
}

/** دوام افتراضي لموظفة في فرع؛ السجل مباشرة عشان ما يعتمدش على يوم الجدولة. */
export async function seedDefaultHours(
  f: AttendanceStatementApiFixture,
  employeeId: string,
  shifts: ScheduleShift[],
  branchId = f.branch,
) {
  for (const shift of shifts) {
    await f.h
      .owner`INSERT INTO employee_default_shifts(company_id,business_id,employee_id,branch_id,day,start,"end",
        break_start,break_end,updated_by,updated_at)
      VALUES(${f.company},${f.business},${employeeId},${branchId},${shift.day},${shift.start}::time,${shift.end}::time,
        ${shift.break_start ?? null}::time,${shift.break_end ?? null}::time,${f.userId},now())`;
  }
}
