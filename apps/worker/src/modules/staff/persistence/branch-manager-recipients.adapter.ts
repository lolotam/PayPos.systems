import {
  branchManagerRecipients,
  branchManagerRecipientsStatement as recipientStatement,
} from '../../identity/index.ts';
import type { BranchManagerRecipients } from '../ports/branch-manager-recipients.port.ts';

// الاختبار يعيد نفس جملة الهوية؛ إعادة تصدير الدالة نفسها ممنوعة لأن القراءة تُستدعى هنا فقط.
export function branchManagerRecipientsStatement(
  companyId: string,
  businessId: string,
  branchId: string,
  at: Date,
  roles: readonly string[],
) {
  return recipientStatement(companyId, businessId, branchId, at, roles);
}

export const branchManagerRecipientsAdapter: BranchManagerRecipients = {
  forBranch: (tx, companyId, businessId, branchId, at, roles) =>
    branchManagerRecipients(tx, companyId, businessId, branchId, at, roles),
};
