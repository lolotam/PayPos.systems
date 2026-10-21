import type { TenantWrappers, Tx } from '@pospay/db';
import type {
  LinePerformersRepository,
  LinePerformersTransaction,
  LinePerformersTransactions,
} from '../ports/line-performers.port.ts';
import type { SessionWriteContext } from '../ports/service-session-transactions.port.ts';
import { editorName } from './editor-name.adapter.ts';
import { loadEditableSession, loadLineForUpdate, lockLineEditVisit } from './line-edit-records.ts';
import { lineIdentity } from './line-identity-records.ts';
import { currentPerformers, isPriceEdited } from './line-performers-records.ts';
import {
  bumpPerformersRevision,
  insertPerformerChange,
  insertPerformerSide,
  replaceLinePerformers,
} from './line-performers-writes.ts';
import { createLineWriteTransactions } from './line-write-transactions.ts';
import { performerCheck } from './performer-check.adapter.ts';
import { sessionPerformersAccess } from './session-edit-access.adapter.ts';
import { sessionPlace } from './session-place.adapter.ts';

const PERFORMERS_OPERATION = 'change-line-performers';

interface LinePerformersReaders {
  place: LinePerformersTransaction['place'];
  access: LinePerformersTransaction['access'];
  editors: LinePerformersTransaction['editors'];
  performers: LinePerformersTransaction['performers'];
  identities: LinePerformersTransaction['identities'];
}

type LinePerformersBody = LinePerformersReaders & { lines: LinePerformersRepository };

export function createLinePerformersTransactions(
  database: TenantWrappers,
  bind: (tx: Tx, context: SessionWriteContext) => LinePerformersReaders,
): LinePerformersTransactions {
  return createLineWriteTransactions<LinePerformersBody>(database, PERFORMERS_OPERATION, (tx, context) =>
    assembleLinePerformers(tx, context, bind),
  );
}

export function bindLinePerformersReaders(tx: Tx, context: SessionWriteContext): LinePerformersReaders {
  return {
    place: sessionPlace(tx, context.companyId, context.businessId, context.branchId),
    access: sessionPerformersAccess(tx, context.companyId, context.userId, context.businessId, context.branchId),
    editors: editorName(tx, context.companyId, context.businessId),
    performers: performerCheck(tx, context.companyId, context.businessId, context.branchId),
    identities: lineIdentity(tx, {
      companyId: context.companyId,
      businessId: context.businessId,
      branchId: context.branchId,
    }),
  };
}

function assembleLinePerformers(
  tx: Tx,
  context: SessionWriteContext,
  bind: (tx: Tx, context: SessionWriteContext) => LinePerformersReaders,
): LinePerformersBody {
  const scope = { companyId: context.companyId, businessId: context.businessId, branchId: context.branchId };
  return {
    ...bind(tx, context),
    lines: {
      lockVisit: (sessionId) => lockLineEditVisit(tx, sessionId),
      loadLineForUpdate: (sessionId, lineId) => loadLineForUpdate(tx, scope, sessionId, lineId),
      loadSession: (sessionId) => loadEditableSession(tx, scope, sessionId),
      currentPerformers: (sessionId, lineId) => currentPerformers(tx, scope, sessionId, lineId),
      isPriceEdited: (sessionId, lineId) => isPriceEdited(tx, scope, sessionId, lineId),
      insertChange: (sessionId, lineId, header) => insertPerformerChange(tx, scope, sessionId, lineId, header),
      insertSide: (changeId, side, rows) => insertPerformerSide(tx, scope, changeId, side, rows),
      bumpRevision: (sessionId, lineId, expectedRevision, warning) =>
        bumpPerformersRevision(tx, scope, sessionId, lineId, expectedRevision, warning),
      replacePerformers: (sessionId, lineId, rows) => replaceLinePerformers(tx, scope, sessionId, lineId, rows),
    },
  };
}
