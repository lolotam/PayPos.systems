import type { Tx } from '@pospay/db';
import { branchManagerRecipients } from '../../identity/index.ts';
import { companyOpen } from '../../tenancy/index.ts';
import type { LateNoticeRecipients } from '../ports/late-service-session-notice.port.ts';

export function lateNoticeRecipients(tx: Tx): LateNoticeRecipients {
  return {
    companyOpen: (companyId) => companyOpen(tx, companyId),
    forBranch: (session, at, roles) =>
      branchManagerRecipients(
        tx,
        session.companyId,
        session.businessId,
        session.branchId,
        at,
        roles,
      ),
  };
}
