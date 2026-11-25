import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import type { Redis } from 'ioredis';

import { systemClock } from '../../shared/adapters/system-clock.ts';
import {
  STAFF_ACCESS_ROUTES_ENABLED,
  EmployeeAccessController,
} from './http/employee-access.controller.ts';
import { EMPLOYEE_ACCESS_STATE_READS } from './queries/employee-staff-access.query.ts';
import { createEmployeeAccessStateReads } from './persistence/employee-access-reads.adapter.ts';
import {
  createStaffAccessCancelUser,
  createCancelPendingStaffAccessSteps,
  createStaffAccessUserSteps,
} from './persistence/staff-access-auth.adapter.ts';
import {
  createGrantEmployeeAccessSteps,
  createStaffAccessGrantCache,
} from './persistence/staff-access.adapter.ts';
import { createStaffAccessGrantAdmission } from './persistence/staff-access-admission.adapter.ts';
import type { AuthFacadeForStaffAccess } from './ports/staff-access-auth.port.ts';
import { GrantEmployeeAccessUseCase } from './use-cases/grant-employee-access/grant-employee-access.ts';
import { CancelPendingStaffAccessUseCase } from './use-cases/cancel-pending-staff-access/cancel-pending-staff-access.ts';

/**
 * ربط قدرة «إعطاء الدخول»: بوابة التفعيل من بيئة التشغيل، وخطوة auth عبر identity لما تكون موجودة،
 * والuse cases بلا قاعدة بيانات يرجعون null فكل المسارات ترد NOT_READY.
 *
 * @param database        مغلفات الشركة من @pospay/db أو undefined في تطبيق بلا قاعدة
 * @param redis           عميل Redis لإبطال الكاش أو undefined
 * @param ids             مولّد UUID v7
 * @param auth            واجهة حساب الموظفة عبر identity أو null
 * @param routesEnabled   بوابة STAFF_ACCESS_ROUTES المقروءة مرة واحدة عند التشغيل
 * @param phoneHashSecret مفتاح بصمة الهاتف (HMAC) أو null — null أو فاضي يمنع بناء الخطوات فترد
 *                        المسارات NOT_READY بدل ما تكتب بصمة بلا مفتاح
 * @returns الـ providers المضافة لموديول staff
 */
export function staffAccessProviders(
  database: TenantWrappers | undefined,
  redis: Redis | undefined,
  ids: IdGenerator,
  auth: AuthFacadeForStaffAccess | null,
  routesEnabled: boolean,
  phoneHashSecret: Buffer | string | null = null,
): Provider[] {
  const cache = createStaffAccessGrantCache(redis);
  const users = auth === null ? null : createStaffAccessUserSteps(auth);
  const cancelUser = auth === null ? null : createStaffAccessCancelUser(auth);
  const steps =
    database === undefined ||
    auth === null ||
    phoneHashSecret === null ||
    phoneHashSecret.length === 0
      ? null
      : createGrantEmployeeAccessSteps(database, auth, phoneHashSecret);
  const cancelSteps = database === undefined ? null : createCancelPendingStaffAccessSteps(database);
  return [
    { provide: STAFF_ACCESS_ROUTES_ENABLED, useValue: routesEnabled },
    {
      provide: EMPLOYEE_ACCESS_STATE_READS,
      useValue:
        database === undefined || auth === null ? null : createEmployeeAccessStateReads(auth),
    },
    {
      provide: GrantEmployeeAccessUseCase,
      useValue:
        steps === null || users === null
          ? null
          : new GrantEmployeeAccessUseCase(
              steps,
              users,
              cache,
              systemClock,
              ids,
              createStaffAccessGrantAdmission(),
            ),
    },
    {
      provide: CancelPendingStaffAccessUseCase,
      useValue:
        cancelSteps === null || cancelUser === null
          ? null
          : new CancelPendingStaffAccessUseCase(cancelSteps, cancelUser, systemClock, ids),
    },
    EmployeeAccessController,
  ];
}

export { EmployeeAccessController };
export type { AuthFacadeForStaffAccess };
