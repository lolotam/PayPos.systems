import { lockBusinessLogoReference } from '@pospay/db';

import type { LogoReference } from '../ports/logo-reference.port.ts';

export function logoReference(): LogoReference {
  return {
    holds: (tx, companyId, businessId, fileId) =>
      lockBusinessLogoReference(tx, companyId, businessId, fileId),
  };
}
