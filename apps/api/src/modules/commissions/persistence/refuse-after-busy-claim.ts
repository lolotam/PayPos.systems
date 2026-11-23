import { IdempotencyKeyBusyError, type TenantWrappers, type Tx } from '@pospay/db';

import { CommissionPlanVersionError } from '../domain/errors.ts';

type Refusal = ConstructorParameters<typeof CommissionPlanVersionError>[0];

// انتهاء انتظار المفتاح بـ Busy بيلغي معاملة الكتابة، فالصلاحية بتتقرا في معاملة جديدة بعد ما الأولى خلصت.
export async function refuseAfterBusyClaim<T>(
  database: TenantWrappers,
  command: { companyId: string; userId: string },
  write: () => Promise<T>,
  scopeOf: (tx: Tx) => { recheckAccess: () => Promise<Refusal | null> },
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof IdempotencyKeyBusyError) {
      await database.withTenant(
        command.companyId,
        async (tx) => {
          const failure = await scopeOf(tx).recheckAccess();
          if (failure !== null) throw new CommissionPlanVersionError(failure);
        },
        { userId: command.userId },
      );
    }
    throw error;
  }
}
