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
  createResetEmployeeStaffPinSteps,
  createStaffAccessUserSteps,
} from './persistence/staff-access-auth.adapter.ts';
import {
  createGrantEmployeeAccessSteps,
  createStaffAccessGrantCache,
} from './persistence/staff-access.adapter.ts';
import {
  createChangeEmployeeStaffPhoneSteps,
  createStaffAccessPhoneUserSteps,
} from './persistence/staff-access-phone.adapter.ts';
import {
  createStaffAccessSessionEnder,
  createStopEmployeeStaffAccessSteps,
} from './persistence/staff-access-stop.adapter.ts';
import { createStaffAccessGrantAdmission } from './persistence/staff-access-admission.adapter.ts';
import type { AuthFacadeForStaffAccess } from './ports/staff-access-auth.port.ts';
import type { StaffAccessGrantCache, StaffAccessUserSteps } from './ports/staff-access.port.ts';
import { GrantEmployeeAccessUseCase } from './use-cases/grant-employee-access/grant-employee-access.ts';
import { CancelPendingStaffAccessUseCase } from './use-cases/cancel-pending-staff-access/cancel-pending-staff-access.ts';
import { ResetEmployeeStaffPinUseCase } from './use-cases/reset-employee-staff-pin/reset-employee-staff-pin.ts';
import { ChangeEmployeeStaffPhoneUseCase } from './use-cases/change-employee-staff-phone/change-employee-staff-phone.ts';
import { StopEmployeeStaffAccessUseCase } from './use-cases/stop-employee-staff-access/stop-employee-staff-access.ts';

/**
 * مزوّد use case تغيير الهاتف: يرجع null لو قاعدة البيانات أو auth أو مفتاح بصمة الهاتف ناقص،
 * فيرد المسار NOT_READY بدل ما يكتب بصمة بلا مفتاح.
 */
function changePhoneProvider(deps: {
  database: TenantWrappers | undefined;
  auth: AuthFacadeForStaffAccess | null;
  users: StaffAccessUserSteps | null;
  phoneHashSecret: Buffer | string | null;
  cache: StaffAccessGrantCache;
  ids: IdGenerator;
}): Provider {
  const { database, auth, users, phoneHashSecret, cache, ids } = deps;
  const steps =
    database === undefined || phoneHashSecret === null || phoneHashSecret.length === 0
      ? null
      : createChangeEmployeeStaffPhoneSteps(database, phoneHashSecret);
  const phoneUsers =
    auth === null || users === null ? null : createStaffAccessPhoneUserSteps(auth, users.hash);
  return {
    provide: ChangeEmployeeStaffPhoneUseCase,
    useValue:
      steps === null || phoneUsers === null
        ? null
        : new ChangeEmployeeStaffPhoneUseCase(steps, phoneUsers, cache, systemClock, ids),
  };
}

/** مزوّد use case «إيقاف الدخول»: null بلا قاعدة بيانات أو auth فيرد المسار NOT_READY. */
function stopProvider(deps: {
  database: TenantWrappers | undefined;
  auth: AuthFacadeForStaffAccess | null;
  cache: StaffAccessGrantCache;
  ids: IdGenerator;
}): Provider {
  const { database, auth, cache, ids } = deps;
  return {
    provide: StopEmployeeStaffAccessUseCase,
    useValue:
      database === undefined || auth === null
        ? null
        : new StopEmployeeStaffAccessUseCase(
            createStopEmployeeStaffAccessSteps(database),
            createStaffAccessSessionEnder(auth),
            cache,
            systemClock,
            ids,
          ),
  };
}

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
  const resetSteps = database === undefined ? null : createResetEmployeeStaffPinSteps(database);
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
    {
      provide: ResetEmployeeStaffPinUseCase,
      useValue:
        resetSteps === null || users === null
          ? null
          : new ResetEmployeeStaffPinUseCase(resetSteps, users, systemClock, ids),
    },
    changePhoneProvider({ database, auth, users, phoneHashSecret, cache, ids }),
    stopProvider({ database, auth, cache, ids }),
    EmployeeAccessController,
  ];
}

export { EmployeeAccessController };
export type { AuthFacadeForStaffAccess };
