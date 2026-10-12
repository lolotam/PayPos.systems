import { attendanceCapabilities, type AttendanceCapabilities } from '@pospay/contracts';
import type { RequestAuthorizer } from '../../../shared/request-authorizer.ts';
import type { AttendanceBoardScope } from './attendance-board.query.ts';

// أزرار الحضور تعتمد على نفس تقييم الحارس الحي، دون إعادة تفسير المنح أو حماية المالك.
export async function readAttendanceCapabilities(
  authorizer: RequestAuthorizer,
  scope: AttendanceBoardScope,
  userId: string,
): Promise<AttendanceCapabilities> {
  const check = async (permission: string) =>
    (await authorizer.execute({
      userId,
      requestedCompany: scope.companyId,
      branchParam: scope.branchId,
      permission,
    })) !== null;
  return attendanceCapabilities.parse({
    correct: await check('correct:attendance:branch'),
    resolve: await check('resolve:attendance:branch'),
    request_change: await check('request:attendance-change:branch'),
    decide: await check('decide:attendance-change:company'),
  });
}
