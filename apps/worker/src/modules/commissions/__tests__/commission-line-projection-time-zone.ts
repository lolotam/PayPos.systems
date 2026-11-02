import type { BusinessTimeZoneReader } from '../persistence/commission-line-projection.scope.ts';

export function fakeBusinessTimeZone(existingBusinessId: string): BusinessTimeZoneReader {
  return async (_tx, _companyId, businessId) =>
    businessId === existingBusinessId ? 'Asia/Kuwait' : null;
}
