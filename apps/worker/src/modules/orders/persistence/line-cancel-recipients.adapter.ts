import type { Tx } from '@pospay/db';
import { branchManagerRecipients } from '../../identity/index.ts';
import { companyOpen } from '../../tenancy/index.ts';
import type { LineCancelNoticeRecipients } from '../ports/line-cancel-notice.port.ts';

export function lineCancelRecipients(tx: Tx): LineCancelNoticeRecipients {
  return {
    companyOpen: (companyId) => companyOpen(tx, companyId),
    branchManagerRecipients: (line, at, roles) =>
      branchManagerRecipients(tx, line.companyId, line.businessId, line.branchId, at, roles),
  };
}
