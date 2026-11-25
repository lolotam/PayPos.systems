import type { Provider } from '@nestjs/common';
import type { TenantWrappers } from '@pospay/db';
import type { Redis } from 'ioredis';
import type { IdGenerator } from '../../shared/ports/id-generator.port.ts';
import { createEmployeeUpdateTransactions } from './persistence/drizzle-employee-update.ts';
import { createStaffAccessGrantCache } from './persistence/staff-access.adapter.ts';
import { UpdateEmployeeUseCase } from './use-cases/update-employee/update-employee.usecase.ts';

/**
 * يربط use case تعديل الموظفة بقاعدة البيانات وبإبطال كاش المنح بعد التزام نقل عضويتها (FR-F3-3).
 *
 * @param database منفذ المعاملات، أو غيابه في تطبيق بلا قاعدة
 * @param redis    عميل Redis للكاش، أو غيابه
 * @param ids      مولّد المعرّفات
 * @returns مزوّد Nest للـ use case
 */
export function updateEmployeeProvider(
  database: TenantWrappers | undefined,
  redis: Redis | undefined,
  ids: IdGenerator,
): Provider {
  return {
    provide: UpdateEmployeeUseCase,
    useValue:
      database === undefined
        ? null
        : new UpdateEmployeeUseCase(
            createEmployeeUpdateTransactions(database, ids, createStaffAccessGrantCache(redis)),
            ids,
          ),
  };
}
