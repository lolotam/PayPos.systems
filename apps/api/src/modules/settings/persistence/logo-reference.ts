import { lockBusinessLogoReference as lockShared } from '@pospay/db';

import type { BusinessLogoReference } from '../ports/logo-reference.port.ts';

export const lockBusinessLogoReference: BusinessLogoReference['lock'] = (
  tx,
  companyId,
  businessId,
  fileId,
) => lockShared(tx, companyId, businessId, fileId);
