import type { Tx } from '@pospay/db';
import { discountApproverRecipients } from '../../identity/index.ts';
import { companyOpen } from '../../tenancy/index.ts';
import type { DiscountApprovalNoticeRecipients } from '../ports/discount-approval-notice.port.ts';

export function discountApprovalRecipients(tx: Tx): DiscountApprovalNoticeRecipients {
  return {
    companyOpen: (companyId) => companyOpen(tx, companyId),
    discountApproverRecipients: (request, at) =>
      discountApproverRecipients(tx, request.companyId, request.businessId, request.branchId, at),
  };
}
