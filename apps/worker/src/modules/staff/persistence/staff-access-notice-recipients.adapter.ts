import type { Tx } from '@pospay/db';

import { companyOwners } from '../../identity/index.ts';
import { companyOpen } from '../../tenancy/index.ts';
import type { StaffAccessNoticePorts } from '../ports/staff-access-notice.port.ts';

/**
 * مستلمو جرس وصول الدخول: مالكي الشركة النشطون، لأن التنبيه لازم يوصل لصاحب القرار في الشركة كلها.
 * أهلية الشركة بتتحقق قبل اللقطة، فشركة محذوفة ما بتعملش جرس.
 *
 * @param tx معاملة المستأجر
 * @returns منافذ الأهلية والمستلمين على نفس المعاملة
 */
export function staffAccessNoticeRecipients(
  tx: Tx,
): Pick<StaffAccessNoticePorts, 'companyOpen' | 'owners'> {
  return {
    companyOpen: (companyId) => companyOpen(tx, companyId),
    owners: (companyId, at) => companyOwners(tx, companyId, at),
  };
}
