import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDocumentStatusReader } from '../persistence/redis-document-status.ts';
import {
  attendanceStatementRequestStatement,
  readAttendanceStatementStatus,
  type AttendanceStatementScope,
} from '../queries/attendance-statement-status.query.ts';
import {
  attendanceStatementApiFixture,
  seedStatementRequest,
  seedStatusHash,
  type AttendanceStatementApiFixture,
} from './attendance-statement-api.fixture.ts';

let f: AttendanceStatementApiFixture;
beforeAll(async () => {
  f = await attendanceStatementApiFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const scope = (patch: Partial<AttendanceStatementScope> = {}): AttendanceStatementScope => ({
  companyId: f.company,
  userId: f.userId,
  businessId: f.business,
  branchId: f.branch,
  ...patch,
});

const reader = () => createDocumentStatusReader(f.h.redis);

it('the caller of a render reads its state from the request row and the Redis hash', async () => {
  const renderId = await seedStatementRequest(f);
  await seedStatusHash(f, renderId, { state: 'RENDERING' });
  await expect(readAttendanceStatementStatus(f.db, reader(), scope(), renderId)).resolves.toEqual({
    state: 'RENDERING',
  });
});

it('a failed render carries its error code', async () => {
  const renderId = await seedStatementRequest(f);
  await seedStatusHash(f, renderId, { state: 'FAILED', errorCode: 'STATEMENT_EMPTY' });
  await expect(readAttendanceStatementStatus(f.db, reader(), scope(), renderId)).resolves.toEqual({
    state: 'FAILED',
    error_code: 'STATEMENT_EMPTY',
  });
});

it('another caller, another business route, another branch and another company all read as missing', async () => {
  const renderId = await seedStatementRequest(f);
  await seedStatusHash(f, renderId, { state: 'READY' });
  const refused = [
    scope({ userId: f.otherUserId }),
    scope({ businessId: f.secondBusiness }),
    scope({ branchId: f.secondBranch }),
    scope({ companyId: f.otherCompany }),
  ];
  for (const refusedScope of refused) {
    await expect(
      readAttendanceStatementStatus(f.db, reader(), refusedScope, renderId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  }
});

it('EXPLAIN ANALYZE reads the request row through its tenant-leading index', async () => {
  const renderId = await seedStatementRequest(f);
  const plans = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${attendanceStatementRequestStatement(
        f.company,
        f.business,
        f.branch,
        renderId,
        f.userId,
      )}`,
    );
  });
  expect(JSON.stringify(plans)).toMatch(/attendance_statement_requests_[a-z_]+/);
});
