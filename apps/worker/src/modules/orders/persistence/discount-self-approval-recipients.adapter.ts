import type { Tx } from '@pospay/db';
import { branchManagerRecipients } from '../../identity/index.ts';
import { companyOpen } from '../../tenancy/index.ts';
import type { DiscountSelfApprovalNoticeRecipients } from '../ports/discount-self-approval-notice.port.ts';

export function discountSelfApprovalRecipients(tx: Tx): DiscountSelfApprovalNoticeRecipients {
  return {
    companyOpen: (companyId) => companyOpen(tx, companyId),
    roleRecipients: (event, at, roles) =>
      branchManagerRecipients(tx, event.companyId, event.businessId, event.branchId, at, roles),
  };
}
