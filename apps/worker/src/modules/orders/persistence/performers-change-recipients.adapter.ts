import type { Tx } from '@pospay/db';
import { branchManagerRecipients } from '../../identity/index.ts';
import { companyOpen } from '../../tenancy/index.ts';
import type { PerformersChangeNoticeRecipients } from '../ports/performers-change-notice.port.ts';

export function performersChangeRecipients(tx: Tx): PerformersChangeNoticeRecipients {
  return {
    companyOpen: (companyId) => companyOpen(tx, companyId),
    branchManagerRecipients: (line, at, roles) =>
      branchManagerRecipients(tx, line.companyId, line.businessId, line.branchId, at, roles),
  };
}
