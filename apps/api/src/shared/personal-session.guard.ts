import type { FastifyRequest } from 'fastify';
import type { PersonalAuthentication } from './personal-authentication.ts';
import { ApiError } from './errors.ts';
import { toWebHeaders } from './web-headers.ts';

/** هذه الغاية لا تتراجع إلى cookie الإدارة أو Device مهما كانت صلاحيات المستخدم. */
export async function personalSessionRequest(
  request: FastifyRequest,
  auth: PersonalAuthentication | null,
) {
  if (
    auth === null ||
    auth.origin === null ||
    request.headers.origin !== auth.origin ||
    request.headers.authorization !== undefined
  )
    throw new ApiError('UNAUTHENTICATED');
  const session = await auth.sessions.resolve(toWebHeaders(request));
  if (session === null) throw new ApiError('UNAUTHENTICATED');
  const employeeId = await auth.eligibility.employee(session.userId, session.context);
  if (employeeId === null) throw new ApiError('UNAUTHENTICATED');
  request.personalSession = session;
  request.personalEmployeeId = employeeId;
  // لا عضويات أو grants في principal هذه الغاية؛ المسارات المعلنة نفسها تضبط own scope.
  request.principal = {
    kind: 'user',
    userId: session.userId,
    employeeId,
    companyId: session.context.companyId,
    deviceId: null,
    memberships: [],
    grants: [],
  };
  return true;
}
