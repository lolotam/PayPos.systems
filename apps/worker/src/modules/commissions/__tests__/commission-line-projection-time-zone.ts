import type { BusinessTimeZoneReader } from '../ports/commission-line-projection.port.ts';

export function fakeBusinessTimeZone(existingBusinessId: string): BusinessTimeZoneReader {
  return async (_tx, _companyId, businessId) =>
    businessId === existingBusinessId ? 'Asia/Kuwait' : null;
}
