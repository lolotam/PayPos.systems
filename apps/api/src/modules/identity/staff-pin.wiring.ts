import type { Provider } from '@nestjs/common';
import type { AuthService, PrivateViewFacade, StaffSessions } from '@pospay/auth';
import { STAFF_LOGIN_CONCURRENCY } from '@pospay/auth';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import type { Redis } from 'ioredis';

import type { Clock } from '../../shared/ports/clock.port.ts';
import { AUTH_SERVICE } from '../../shared/session.guard.ts';
import { PRIVATE_VIEW_WINDOWS } from './http/private-view.controller.ts';
import {
  STAFF_PIN_CHANGE_ENABLED,
  STAFF_PIN_USE_CASES,
  type StaffPinUseCases,
} from './http/staff-pin.controller.ts';
import { authPinHasher } from './persistence/auth-pin-hasher.ts';
import { createRedisDevicePinCap } from './persistence/redis-device-pin-cap.ts';
import { createRedisPinAttempts } from './persistence/redis-pin-attempts.ts';
import { createStaffEligibility } from './persistence/staff-eligibility.ts';
import { createStaffPinComparisonGate } from './persistence/staff-pin-comparison-gate.ts';
import { createStaffPinProofIssuer } from './persistence/staff-pin-proofs.ts';
import { createStaffPinTransactions } from './persistence/staff-pin-transactions.ts';
import type { StaffPinComparisonGate } from './ports/staff-pins.port.ts';
import { ChangeTemporaryStaffPin } from './use-cases/change-temporary-staff-pin/change-temporary-staff-pin.ts';
import { OpenPrivateView } from './use-cases/open-private-view/open-private-view.ts';
import { ResetStaffPin } from './use-cases/reset-staff-pin/reset-staff-pin.ts';
import { SignInStaffPin } from './use-cases/sign-in-staff-pin/sign-in-staff-pin.ts';
import { VerifyDiscountApproverPin } from './use-cases/verify-discount-approver-pin/verify-discount-approver-pin.ts';

/** توكن التحقق من PIN اعتماد الخصم — الـ provider بيربطه بالـ use case، والـ orders بيحقنه. */
export const VERIFY_DISCOUNT_APPROVER_PIN = Symbol('VERIFY_DISCOUNT_APPROVER_PIN');

/**
 * ربط مسارات الرقم السري للموظفات والعرض الخاص واعتماد الخصم على بوابة تزامن عملية واحدة
 * (STAFF_LOGIN_CONCURRENCY)؛ فصلته عن identity.module التزاماً بحد الـ 300/400 سطر.
 *
 * @param options تبعيات قاعدة البيانات وRedis وجلسات الموظفات والساعة لتكوين بوابة التزامن المشتركة
 * @param options.database          مغلفات قاعدة بيانات الشركة، أو undefined قبل التهيئة
 * @param options.ids               مولّد الـ UUID v7
 * @param options.redis             عميل Redis لمحاولات الـ PIN وسقف الجهاز
 * @param options.sessions          جلسات الموظفات في الاعتماد العام
 * @param options.staffAccessRoutes تفعيل مسار تغيير الرقم المؤقت (شجرة 076)
 * @param options.clock             الساعة المستخدمة لقياس عمر الرقم المؤقت والدليل
 * @returns الـ providers الخاصة بمسارات PIN والعرض الخاص والخصم
 */
export function staffPinAndPrivateViewProviders(options: {
  readonly database: TenantWrappers | undefined;
  readonly ids: IdGenerator;
  readonly redis: Redis | undefined;
  readonly sessions: StaffSessions | null;
  readonly staffAccessRoutes: boolean;
  readonly clock: Clock;
}): Provider[] {
  const { database, ids, redis, sessions, staffAccessRoutes, clock } = options;
  const gate = createStaffPinComparisonGate(STAFF_LOGIN_CONCURRENCY);
  return [
    ...staffPinProviders(database, ids, redis, sessions, staffAccessRoutes, clock, gate),
    ...discountApproverProviders(database, ids, redis, sessions, gate),
    ...privateViewProviders(database, ids, redis, gate),
  ];
}

// ربط النافذة الخاصة منفصل؛ يعتمد على بوابة التزامن المشتركة نفسها مع دخول الموظفة واعتماد الخصم.
function privateViewProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  redis: Redis | undefined,
  gate: StaffPinComparisonGate,
): Provider[] {
  return [
    {
      provide: PRIVATE_VIEW_WINDOWS,
      useFactory: (auth: AuthService | null): Pick<PrivateViewFacade, 'close'> | null =>
        auth?.privateView ?? null,
      inject: [AUTH_SERVICE],
    },
    {
      provide: OpenPrivateView,
      useFactory: (auth: AuthService | null): OpenPrivateView | null =>
        database === undefined || redis === undefined || auth === null
          ? null
          : new OpenPrivateView(
              createStaffPinTransactions(database, ids),
              createRedisPinAttempts(redis, ids),
              createStaffEligibility(database),
              auth.privateView,
              gate,
            ),
      inject: [AUTH_SERVICE],
    },
  ];
}

// مسارات الرقم السري للموظفات: الدخول والتغيير والإعادة. من غير داتابيز أو Redis أو جلسات المسار كله بيرفض.
function staffPinProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  redis: Redis | undefined,
  sessions: StaffSessions | null,
  staffAccessRoutes: boolean,
  clock: Clock,
  gate: StaffPinComparisonGate,
): Provider[] {
  return [
    {
      provide: STAFF_PIN_USE_CASES,
      useValue:
        database === undefined
          ? null
          : staffPinUseCases(database, ids, redis, sessions, staffAccessRoutes, clock, gate),
    },
    { provide: STAFF_PIN_CHANGE_ENABLED, useValue: staffAccessRoutes },
  ];
}

function staffPinUseCases(
  database: TenantWrappers,
  ids: IdGenerator,
  redis: Redis | undefined,
  sessions: StaffSessions | null,
  staffAccessRoutes: boolean,
  clock: Clock,
  gate: StaffPinComparisonGate,
): StaffPinUseCases | null {
  if (redis === undefined || sessions === null) return null;
  const db = createStaffPinTransactions(database, ids);
  const eligibility = createStaffEligibility(database);
  const proofs = createStaffPinProofIssuer();
  return {
    reset: new ResetStaffPin(db, authPinHasher, clock),
    signIn: new SignInStaffPin(
      db,
      authPinHasher,
      createRedisPinAttempts(redis, ids),
      { sessions, ...eligibility },
      proofs,
      clock,
      ids,
      staffAccessRoutes,
      gate,
    ),
    change: new ChangeTemporaryStaffPin(
      db,
      authPinHasher,
      createRedisPinAttempts(redis, ids),
      proofs,
      clock,
      eligibility,
    ),
  };
}

// التحقق من PIN اعتماد الخصم بيحتاج داتابيز وRedis وجلسات اعتماد معاً؛ ويشارك نفس بوابة التزامن.
function discountApproverProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  redis: Redis | undefined,
  sessions: StaffSessions | null,
  gate: StaffPinComparisonGate,
): Provider[] {
  if (database === undefined || redis === undefined || sessions === null) {
    return [{ provide: VERIFY_DISCOUNT_APPROVER_PIN, useValue: null }];
  }
  const eligibility = createStaffEligibility(database);
  return [
    {
      provide: VERIFY_DISCOUNT_APPROVER_PIN,
      useValue: new VerifyDiscountApproverPin(
        createStaffPinTransactions(database, ids),
        authPinHasher,
        createRedisPinAttempts(redis, ids),
        sessions,
        createRedisDevicePinCap(redis, ids),
        { valid: (device) => eligibility.context(device).then((found) => found !== null) },
        gate,
      ),
    },
  ];
}
