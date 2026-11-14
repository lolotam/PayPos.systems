import type { Tx } from '@pospay/db';
import {
  lockServiceSessionCancelAccess,
  lockServiceSessionEditAccess,
  lockServiceSessionPerformersAccess,
  readPackageExtensionAccess,
  readServiceSessionCancelAccess,
  readServiceSessionEditAccess,
  readServiceSessionPerformersAccess,
} from '../../identity/index.ts';
import type { SessionEditAccessPort } from '../ports/line-edit.port.ts';

function sessionLineAccess(
  lock: () => Promise<void>,
  read: SessionEditAccessPort['read'],
): SessionEditAccessPort {
  return { lock, read };
}

export function sessionEditAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
): SessionEditAccessPort {
  return sessionLineAccess(
    () => lockServiceSessionEditAccess(tx, companyId),
    (at) => readServiceSessionEditAccess(tx, companyId, userId, businessId, branchId, at),
  );
}

export function sessionCancelAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
): SessionEditAccessPort {
  return sessionLineAccess(
    () => lockServiceSessionCancelAccess(tx, companyId),
    (at) => readServiceSessionCancelAccess(tx, companyId, userId, businessId, branchId, at),
  );
}

export function sessionPerformersAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
): SessionEditAccessPort {
  return sessionLineAccess(
    () => lockServiceSessionPerformersAccess(tx, companyId),
    (at) => readServiceSessionPerformersAccess(tx, companyId, userId, businessId, branchId, at),
  );
}

// قدرة التمديد لزرار شاشة الباقة: نفس قرار ExtendPackageUseCase بس من غير قفل الشركة.
export async function packageExtendCapability(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
  at: Date,
): Promise<boolean> {
  const access = await readPackageExtensionAccess(tx, companyId, userId, businessId, branchId, at);
  return !access.denied && access.feature && access.eligible.length > 0;
}

// قراءة القدرة بلا FOR SHARE؛ قفل الشركة هنا كان هيعلّق قائمة اليوم.
export function sessionCancelCapability(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
  at: Date,
): Promise<{ denied: boolean; feature: boolean; eligible: readonly unknown[] }> {
  return readServiceSessionCancelAccess(tx, companyId, userId, businessId, branchId, at);
}

// زي قدرة الإلغاء: قراءة من غير FOR SHARE عشان قائمة اليوم ما تستناش قفل الشركة (PP-19.2).
export function sessionPerformersCapability(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
  at: Date,
): Promise<{ denied: boolean; feature: boolean; eligible: readonly unknown[] }> {
  return readServiceSessionPerformersAccess(tx, companyId, userId, businessId, branchId, at);
}
