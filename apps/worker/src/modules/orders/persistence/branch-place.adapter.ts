import type { Tx } from '@pospay/db';
import { branchPlace } from '../../tenancy/index.ts';
import type { LateNoticePlace } from '../ports/late-service-session-notice.port.ts';

export function lateNoticePlace(tx: Tx): LateNoticePlace {
  return {
    forBranch: async (session) => {
      const place = await branchPlace(tx, session.companyId, session.businessId, session.branchId);
      return place === null ? null : { nameAr: place.nameAr, nameEn: place.nameEn };
    },
  };
}
