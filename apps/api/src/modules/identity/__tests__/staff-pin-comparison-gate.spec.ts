import type { ValueProvider } from '@nestjs/common';
import { STAFF_LOGIN_CONCURRENCY, type AuthService, type StaffSessions } from '@pospay/auth';
import type { TenantWrappers } from '@pospay/db';
import type { Redis } from 'ioredis';
import { expect, it, vi } from 'vitest';

import { STAFF_PIN_USE_CASES, type StaffPinUseCases } from '../http/staff-pin.controller.ts';
import { createStaffPinComparisonGate } from '../persistence/staff-pin-comparison-gate.ts';
import {
  staffPinAndPrivateViewProviders,
  VERIFY_DISCOUNT_APPROVER_PIN,
} from '../staff-pin.wiring.ts';
import { OpenPrivateView } from '../use-cases/open-private-view/open-private-view.ts';
import type { VerifyDiscountApproverPin } from '../use-cases/verify-discount-approver-pin/verify-discount-approver-pin.ts';

const device = {
  companyId: 'synthetic-company',
  businessId: 'synthetic-business',
  branchId: 'synthetic-branch',
  deviceId: 'synthetic-device',
};
const phone = '+99900000001';
const pin = String(10).padStart(4, '0');

function wiredGatePeers(barrier: Promise<void>) {
  let step = 0;
  const database = { withTenant: vi.fn() } as unknown as TenantWrappers;
  const redis = {
    eval: vi.fn(async () => {
      await barrier;
      return 'locked';
    }),
    del: vi.fn(async () => 0),
  } as unknown as Redis;
  const sessions = {
    ready: vi.fn(() => barrier),
    candidate: vi.fn(async () => null),
    pinCounterKey: vi.fn(() => 'counter-key'),
    issue: vi.fn(),
  } as unknown as StaffSessions;
  const auth = {
    privateView: { provePin: vi.fn(async () => null), open: vi.fn(), close: vi.fn() },
  } as unknown as AuthService;

  const providers = staffPinAndPrivateViewProviders({
    database,
    ids: { newId: () => `synthetic-id-${++step}` },
    redis,
    sessions,
    staffAccessRoutes: true,
    clock: { now: () => new Date('2026-11-25T10:00:00.000Z') },
  });
  const staffPinUseCases = (
    providers.find(
      (p) => 'provide' in p && p.provide === STAFF_PIN_USE_CASES,
    ) as ValueProvider<StaffPinUseCases>
  ).useValue;
  const discountApprover = (
    providers.find(
      (p) => 'provide' in p && p.provide === VERIFY_DISCOUNT_APPROVER_PIN,
    ) as ValueProvider<VerifyDiscountApproverPin>
  ).useValue;
  const openPrivateViewFactory = providers.find(
    (
      p,
    ): p is {
      provide: typeof OpenPrivateView;
      useFactory: (auth: AuthService) => OpenPrivateView;
    } => 'provide' in p && p.provide === OpenPrivateView && 'useFactory' in p,
  );
  if (!openPrivateViewFactory) throw new Error('OpenPrivateView provider missing');

  return {
    signIn: staffPinUseCases.signIn,
    openPrivateView: openPrivateViewFactory.useFactory(auth),
    discountApprover,
  };
}

it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
  'createStaffPinComparisonGate refuses invalid limit %s',
  (limit) => {
    expect(() => createStaffPinComparisonGate(limit)).toThrow('STAFF_PIN_GATE_LIMIT_INVALID');
  },
);

it('createStaffPinComparisonGate caps concurrency and makes release idempotent (#786)', () => {
  const gate = createStaffPinComparisonGate(2);
  const first = gate.acquire();
  const second = gate.acquire();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(gate.acquire()).toBeNull();

  // تحرير مزدوج لا يرفع السعة المتاحة عن الحد الأصلي (idempotent release).
  first?.();
  first?.();
  const third = gate.acquire();
  expect(third).not.toBeNull();
  expect(gate.acquire()).toBeNull();

  second?.();
  third?.();
  const a = gate.acquire();
  const b = gate.acquire();
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  expect(gate.acquire()).toBeNull();
  a?.();
  b?.();
});

it('shares one concurrency limit across SignInStaffPin, OpenPrivateView and VerifyDiscountApproverPin via production wiring (#786)', async () => {
  expect(STAFF_LOGIN_CONCURRENCY).toBeGreaterThanOrEqual(3);
  let releaseBarrier: () => void = () => undefined;
  const barrier = new Promise<void>((resolve) => {
    releaseBarrier = resolve;
  });
  const { signIn, openPrivateView, discountApprover } = wiredGatePeers(barrier);
  const session = {
    userId: 'synthetic-user',
    sessionId: 'synthetic-session',
    context: device,
    authenticatedAt: new Date('2026-11-25T09:00:00.000Z'),
    deadline: new Date('2026-11-25T17:00:00.000Z'),
  };
  // تعبئة الحد عبر الثلاثة مسارات من المزوّد الإنتاجي نفسه تضمن كشف أي بوابة منفصلة لأي مسار.
  const running = [
    ...Array.from({ length: STAFF_LOGIN_CONCURRENCY - 2 }, () =>
      signIn.execute({ phone, pin, device }),
    ),
    openPrivateView.execute({ pin, session }),
    discountApprover.execute({ phone, pin, device }),
  ];
  // ربط تأكيدات الفائض قبل فك الحاجز حتى يكشف أي تسرب فوراً بدل التعليق على نفس الحاجز.
  const overflow = Promise.all([
    expect(openPrivateView.execute({ pin, session })).rejects.toThrow('STAFF_PIN_UNAVAILABLE'),
    expect(signIn.execute({ phone, pin, device })).rejects.toThrow('STAFF_PIN_UNAVAILABLE'),
    expect(discountApprover.execute({ phone, pin, device })).resolves.toEqual({ kind: 'busy' }),
  ]);
  releaseBarrier();
  await Promise.all([overflow, ...running]);
  await expect(signIn.execute({ phone, pin, device })).resolves.toBeNull();
  await expect(openPrivateView.execute({ pin, session })).resolves.toEqual({ kind: 'refused' });
  await expect(discountApprover.execute({ phone, pin, device })).resolves.toEqual({
    kind: 'locked',
  });
});
