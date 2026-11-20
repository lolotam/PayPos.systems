import type { FastifyRequest } from 'fastify';
import type { LeaveRequest, OwnLeaveWriteResult } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { ApiError } from '../../../shared/errors.ts';
import type { IdempotencyInput } from '../../../shared/idempotency.ts';
import { LeaveError } from '../use-cases/request-leave/request-leave.usecase.ts';
import { ownLeaveCancelAuthority, type LeaveReadAccess } from '../queries/leave-requests.query.ts';
export function ownLeaveActor(request: FastifyRequest, idem?: IdempotencyInput, branchId?: string) {
  const personal = request.personalSession;
  if (personal && request.personalEmployeeId) {
    if (!branchId)
      throw new ApiError('VALIDATION_FAILED', [{ path: ['branch_id'], code: 'invalid_type' }]);
    return {
      companyId: personal.context.companyId,
      businessId: personal.context.businessId,
      employeeId: request.personalEmployeeId,
      branchId,
      userId: personal.userId,
      own: true,
      ...(idem ?? { key: '', fingerprint: '' }),
    };
  }
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
// الصلاحية بتتقرا حيًا في معاملة مستقلة بعد ما الكتابة اتعملت، وأي فشل فيها معناه false لأن نجاح الكتابة لازم يفضل قايم.
export async function ownLeaveWriteResult(
  database: TenantWrappers | null,
  access: LeaveReadAccess,
  actor: {
    companyId: string;
    businessId: string;
    userId: string;
    branchId: string;
    employeeId?: string;
  },
  record: LeaveRequest,
): Promise<OwnLeaveWriteResult> {
  const context = {
    companyId: actor.companyId,
    userId: actor.userId,
    businessId: actor.businessId,
    branchId: actor.branchId,
    ...(actor.employeeId === undefined ? {} : { employeeId: actor.employeeId }),
    own: true,
  };
  try {
    if (!database) return { ...record, can_cancel: false };
    const can_cancel = await database.withTenant(
      actor.companyId,
      (tx) => ownLeaveCancelAuthority(tx, context, record.id, access),
      { userId: actor.userId },
    );
    return { ...record, can_cancel };
  } catch {
    return { ...record, can_cancel: false };
  }
}
