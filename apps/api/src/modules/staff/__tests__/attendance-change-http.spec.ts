import { expect, it } from 'vitest';
import { errorMessages } from '@pospay/i18n';
import { ApiError } from '../../../shared/errors.ts';
import { AttendanceChangeKindRefusal } from '../ports/attendance-change-kinds.port.ts';
import { attendanceChangeHttpResult } from '../http/attendance-change-http.ts';

it.each([400, 403, 404, 409, 422] as const)(
  'preserves refusal status %s and uses catalog messages',
  async (status) => {
    const refusal = new AttendanceChangeKindRefusal('ATTENDANCE_SESSION_OPEN', status);
    const error = await attendanceChangeHttpResult(Promise.reject(refusal)).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(status);
    expect((error as ApiError).toEnvelope()).toEqual({
      code: refusal.code,
      ...errorMessages('ATTENDANCE_SESSION_OPEN'),
    });
  },
);

it('uses a generic bilingual fallback for a refusal code absent from the catalog', async () => {
  const refusal = new AttendanceChangeKindRefusal('TEST_KIND_REFUSED', 422);
  const error = await attendanceChangeHttpResult(Promise.reject(refusal)).catch((e: unknown) => e);
  expect((error as ApiError).status).toBe(422);
  expect((error as ApiError).toEnvelope()).toEqual({
    code: refusal.code,
    ...errorMessages('BAD_REQUEST'),
  });
});
