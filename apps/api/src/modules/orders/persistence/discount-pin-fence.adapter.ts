import type { TenantWrappers, Tx } from '@pospay/db';
import {
  lockActiveDeviceBusiness,
  lockApproverPinRevision,
  readActiveDeviceBusiness,
} from '../../identity/index.ts';
import type {
  DiscountDecisionDevice,
  DiscountDeviceScopePort,
  DiscountPinFencePort,
} from '../ports/discount-decision.port.ts';

export function discountPinFence(tx: Tx, companyId: string, branchId: string): DiscountPinFencePort {
  return {
    lock: async (proof) => {
      const business = await lockActiveDeviceBusiness(tx, companyId, proof.deviceId, branchId);
      if (business === null) return false;
      return lockApproverPinRevision(tx, companyId, proof.approverUserId, proof.pinRevision);
    },
  };
}

export function discountDeviceScope(database: TenantWrappers): DiscountDeviceScopePort {
  return {
    businessOf: (device) =>
      database.withTenant(device.companyId, (tx) => discountDeviceBusiness(tx, device)),
  };
}

export function discountDeviceBusiness(
  tx: Tx,
  device: DiscountDecisionDevice,
): Promise<string | null> {
  return readActiveDeviceBusiness(tx, device.companyId, device.deviceId, device.branchId);
}
