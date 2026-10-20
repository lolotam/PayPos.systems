import type { TenantWrappers, Tx } from '@pospay/db';
import type { LineCancelRepository, LineCancelTransaction, LineCancelTransactions } from '../ports/line-cancel.port.ts';
import type { SessionWriteContext } from '../ports/service-session-transactions.port.ts';
import { editorName } from './editor-name.adapter.ts';
import { activeLinePerformers } from './line-cancel-records.ts';
import { insertLineCancellation, markLineCancelled } from './line-cancel-writes.ts';
import { loadEditableSession, loadLineForUpdate, lockLineEditVisit } from './line-edit-records.ts';
import { lineIdentity } from './line-identity-records.ts';
import { createLineWriteTransactions } from './line-write-transactions.ts';
import { performerCheck } from './performer-check.adapter.ts';
import { sessionCancelAccess } from './session-edit-access.adapter.ts';
import { sessionPlace } from './session-place.adapter.ts';
import { sessionTipEmployees } from './session-tip-employees.adapter.ts';

const CANCEL_OPERATION = 'cancel-service-line';

interface LineCancelReaders {
  place: LineCancelTransaction['place'];
  access: LineCancelTransaction['access'];
  editors: LineCancelTransaction['editors'];
  performers: LineCancelTransaction['performers'];
  tips: LineCancelTransaction['tips'];
  identities: LineCancelTransaction['identities'];
}

type LineCancelBody = LineCancelReaders & { lines: LineCancelRepository };

export function createLineCancelTransactions(
  database: TenantWrappers,
  bind: (tx: Tx, context: SessionWriteContext) => LineCancelReaders,
): LineCancelTransactions {
  return createLineWriteTransactions<LineCancelBody>(database, CANCEL_OPERATION, (tx, context) => assembleLineCancel(tx, context, bind));
}

export function bindLineCancelReaders(tx: Tx, context: SessionWriteContext): LineCancelReaders {
  return {
    place: sessionPlace(tx, context.companyId, context.businessId, context.branchId),
    access: sessionCancelAccess(tx, context.companyId, context.userId, context.businessId, context.branchId),
    editors: editorName(tx, context.companyId, context.businessId),
    performers: performerCheck(tx, context.companyId, context.businessId, context.branchId),
    tips: sessionTipEmployees(tx, context.companyId, context.businessId, context.branchId),
    identities: lineIdentity(tx, {
      companyId: context.companyId,
      businessId: context.businessId,
      branchId: context.branchId,
    }),
  };
}

function assembleLineCancel(
  tx: Tx,
  context: SessionWriteContext,
  bind: (tx: Tx, context: SessionWriteContext) => LineCancelReaders,
): LineCancelBody {
  const scope = { companyId: context.companyId, businessId: context.businessId, branchId: context.branchId };
  return {
    ...bind(tx, context),
    lines: {
      lockVisit: (sessionId) => lockLineEditVisit(tx, sessionId),
      loadLineForUpdate: (sessionId, lineId) => loadLineForUpdate(tx, scope, sessionId, lineId),
      activePerformers: (sessionId) => activeLinePerformers(tx, scope, sessionId),
      cancelLine: (sessionId, lineId, expectedRevision) => markLineCancelled(tx, scope, sessionId, lineId, expectedRevision),
      insertCancellation: (sessionId, lineId, row) => insertLineCancellation(tx, scope, sessionId, lineId, row),
      loadSession: (sessionId) => loadEditableSession(tx, scope, sessionId),
    },
  };
}
