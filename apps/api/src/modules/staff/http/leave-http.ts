import type { FastifyRequest } from 'fastify';
import { ApiError } from '../../../shared/errors.ts';
import type { IdempotencyInput } from '../../../shared/idempotency.ts';
import { LeaveError } from '../use-cases/request-leave/request-leave.usecase.ts';
export function ownLeaveActor(request: FastifyRequest, idem?: IdempotencyInput) {
  const device = request.staffDevice,
    session = request.staffSession;
  if (!device || !session) throw new ApiError('UNAUTHENTICATED');
  return {
    companyId: device.companyId,
    businessId: device.businessId,
    branchId: device.branchId,
    userId: session.userId,
    own: true,
    ...(idem ?? { key: '', fingerprint: '' }),
  };
}
export async function leaveHttpResult<T>(result: Promise<T>): Promise<T> {
  try {
    return await result;
  } catch (error) {
    if (error instanceof LeaveError) throw new ApiError(error.code);
    throw error;
  }
}
