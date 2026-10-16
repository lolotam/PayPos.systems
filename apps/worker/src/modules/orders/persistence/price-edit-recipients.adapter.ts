import type { Tx } from '@pospay/db';
import { branchManagerRecipients } from '../../identity/index.ts';
import { companyOpen } from '../../tenancy/index.ts';
import type { PriceEditNoticeRecipients } from '../ports/price-edit-notice.port.ts';

export function priceEditRecipients(tx: Tx): PriceEditNoticeRecipients {
  return {
    companyOpen: (companyId) => companyOpen(tx, companyId),
    branchManagerRecipients: (line, at, roles) =>
      branchManagerRecipients(tx, line.companyId, line.businessId, line.branchId, at, roles),
  };
}
