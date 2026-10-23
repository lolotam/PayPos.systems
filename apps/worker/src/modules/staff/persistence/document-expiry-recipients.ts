import type { Tx } from '@pospay/db';
import { inAppAlertOn } from '../domain/alert-rule-plan.ts';
import {
  documentExpiryRecipients,
  documentExpiringParameters,
  type DocumentExpiryParameter,
  type DocumentNameFallback,
} from '../domain/document-expiry-notice.ts';
import type { LockedDocumentExpiry } from '../ports/document-expiry.port.ts';
import { alertRules } from './alert-rule.adapter.ts';
import { branchManagerRecipientsAdapter } from './branch-manager-recipients.adapter.ts';
import { fileReaderRecipientsAdapter } from './file-reader-recipients.adapter.ts';

/** مستلمو جرس انتهاء المستند ومعاملاته كما تخرج من القواعد. */
export interface DocumentExpiryRecipients {
  readonly userIds: readonly string[];
  readonly parameters: readonly DocumentExpiryParameter[];
}

/**
 * من يصل جرس انتهاء المستند (AL-Q7): أصحاب صلاحية read:files:business على النشاط، والقاعدة بتفلترهم
 * بأدوارها: بلا أدوار توصل لكل أصحاب الصلاحية، وبأدوار توصل لمديري فرع الموظفة الأصلي منهم فقط.
 * القاعدة المقفولة أو بلا قناة داخل التطبيق معناها ولا جرس (issue #457).
 *
 * @param tx معاملة الشركة بعد قفل الوثيقة
 * @param companyId الشركة
 * @param locked الوثيقة المقفولة وأسماءها
 * @param at لحظة القرار من الساعة المحقونة
 * @param fallback الأسماء العامة لجرس المستند
 * @returns المستلمون ومعاملاتهم، أو null لما ما يجيش حد
 */
export async function documentExpiryRecipientsFor(
  tx: Tx,
  companyId: string,
  locked: LockedDocumentExpiry,
  at: Date,
  fallback: DocumentNameFallback,
): Promise<DocumentExpiryRecipients | null> {
  if (!(await branchManagerRecipientsAdapter.companyOpen(tx, companyId))) return null;
  const rule = await alertRules(tx).rule(
    companyId,
    { businessId: locked.businessId, branchId: null },
    'DOCUMENT_EXPIRING',
  );
  if (!inAppAlertOn(rule)) return null;
  const holders = await fileReaderRecipientsAdapter.holders(
    tx,
    companyId,
    locked.businessId,
    at,
  );
  const roles = rule.recipientRoles;
  const candidates =
    roles.length === 0
      ? []
      : await branchManagerRecipientsAdapter.forBranch(
          tx,
          companyId,
          locked.businessId,
          locked.primaryBranchId,
          at,
          roles,
        );
  const userIds = documentExpiryRecipients(roles, candidates, holders);
  if (userIds.length === 0) return null;
  const parameters = documentExpiringParameters(
    locked.employeeNameAr,
    locked.employeeNameEn,
    locked.typeNameAr,
    locked.typeNameEn,
    locked.expiresOn,
    locked.documentId,
    fallback,
  );
  if (parameters === null) return null;
  return { userIds, parameters };
}
