import type { TenantWrappers, Tx } from '@pospay/db';
import type { LineEditRepository, LineEditTransaction, LineEditTransactions } from '../ports/line-edit.port.ts';
import type { SessionWriteContext } from '../ports/service-session-transactions.port.ts';
import { discountLimit } from './discount-limit.adapter.ts';
import { editorName } from './editor-name.adapter.ts';
import { activeLineNets, loadEditableSession, loadLineForUpdate, lockLineEditVisit } from './line-edit-records.ts';
import { insertLineEdit, updateLinePrice } from './line-edit-writes.ts';
import { createLineWriteTransactions } from './line-write-transactions.ts';
import { performerCheck } from './performer-check.adapter.ts';
import { sessionEditAccess } from './session-edit-access.adapter.ts';
import { sessionPlace } from './session-place.adapter.ts';

const EDIT_OPERATION = 'edit-service-line-price';

interface LineEditReaders {
  place: LineEditTransaction['place'];
  access: LineEditTransaction['access'];
  editors: LineEditTransaction['editors'];
  performers: LineEditTransaction['performers'];
  discount: LineEditTransaction['discount'];
}

type LineEditBody = LineEditReaders & { lines: LineEditRepository };

export function createLineEditTransactions(
  database: TenantWrappers,
  bind: (tx: Tx, context: SessionWriteContext) => LineEditReaders,
): LineEditTransactions {
  return createLineWriteTransactions<LineEditBody>(database, EDIT_OPERATION, (tx, context) => assembleLineEdit(tx, context, bind));
}

export function bindLineEditReaders(tx: Tx, context: SessionWriteContext): LineEditReaders {
  return {
    place: sessionPlace(tx, context.companyId, context.businessId, context.branchId),
    access: sessionEditAccess(tx, context.companyId, context.userId, context.businessId, context.branchId),
    editors: editorName(tx, context.companyId, context.businessId),
    performers: performerCheck(tx, context.companyId, context.businessId, context.branchId),
    discount: discountLimit(tx, context.companyId, context.businessId),
  };
}

function assembleLineEdit(
  tx: Tx,
  context: SessionWriteContext,
  bind: (tx: Tx, context: SessionWriteContext) => LineEditReaders,
): LineEditBody {
  const scope = { companyId: context.companyId, businessId: context.businessId, branchId: context.branchId };
  return {
    ...bind(tx, context),
    lines: {
      lockVisit: (sessionId) => lockLineEditVisit(tx, sessionId),
      loadLineForUpdate: (sessionId, lineId) => loadLineForUpdate(tx, scope, sessionId, lineId),
      activeNets: (sessionId, exceptLineId) => activeLineNets(tx, scope, sessionId, exceptLineId),
      updateLine: (sessionId, lineId, update) => updateLinePrice(tx, scope, sessionId, lineId, update),
      insertEdit: (sessionId, lineId, edit) => insertLineEdit(tx, scope, sessionId, lineId, edit),
      loadSession: (sessionId) => loadEditableSession(tx, scope, sessionId),
    },
  };
}
