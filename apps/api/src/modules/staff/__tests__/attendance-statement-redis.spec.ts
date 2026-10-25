import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDocumentStatusReader } from '../persistence/redis-document-status.ts';
import {
  readAttendanceStatementStatus,
  type AttendanceStatementScope,
} from '../queries/attendance-statement-status.query.ts';
import {
  attendanceStatementApiFixture,
  seedDocumentBytes,
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

const scope = (): AttendanceStatementScope => ({
  companyId: f.company,
  userId: f.userId,
  businessId: f.business,
  branchId: f.branch,
});

const reader = () => createDocumentStatusReader(f.h.redis);

it('a ready render whose bytes are still there reads as ready', async () => {
  const renderId = await seedStatementRequest(f);
  await seedStatusHash(f, renderId, { state: 'READY', mimeType: 'application/pdf' });
  await seedDocumentBytes(f, renderId);
  await expect(readAttendanceStatementStatus(f.db, reader(), scope(), renderId)).resolves.toEqual({
    state: 'READY',
  });
});

it('a ready render whose bytes are gone reads as expired', async () => {
  const renderId = await seedStatementRequest(f);
  await seedStatusHash(f, renderId, { state: 'READY' });
  await expect(readAttendanceStatementStatus(f.db, reader(), scope(), renderId)).resolves.toEqual({
    state: 'EXPIRED',
  });
});

it('an unknown state makes the whole hash unusable', async () => {
  const renderId = await seedStatementRequest(f);
  await seedStatusHash(f, renderId, { state: 'NOT_A_STATE' });
  await expect(
    readAttendanceStatementStatus(f.db, reader(), scope(), renderId),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

it('an unknown error code is read as no error code at all', async () => {
  const renderId = await seedStatementRequest(f);
  await seedStatusHash(f, renderId, { state: 'FAILED', errorCode: 'NOT_A_CODE' });
  await expect(readAttendanceStatementStatus(f.db, reader(), scope(), renderId)).resolves.toEqual({
    state: 'FAILED',
  });
});

it('a status hash of another user is missing for the caller', async () => {
  const renderId = await seedStatementRequest(f);
  await seedStatusHash(f, renderId, { state: 'QUEUED', requestedBy: f.otherUserId });
  await expect(
    readAttendanceStatementStatus(f.db, reader(), scope(), renderId),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
