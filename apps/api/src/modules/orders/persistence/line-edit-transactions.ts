import {
  IdempotencyKeyBusyError,
  IdempotencyKeyReusedError,
  appendAuditLogs,
  appendOutboxEvent,
  runIdempotent,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { SessionError } from '../domain/session-error.ts';
import type { LineEditAuditEntry, LineEditTransaction, LineEditTransactions } from '../ports/line-edit.port.ts';
import type { SessionWriteContext } from '../ports/service-session-transactions.port.ts';
import { discountLimit } from './discount-limit.adapter.ts';
import { editorName } from './editor-name.adapter.ts';
import { activeLineNets, loadEditableSession, loadLineForUpdate, lockLineEditVisit } from './line-edit-records.ts';
import { insertLineEdit, updateLinePrice } from './line-edit-writes.ts';
import { performerCheck } from './performer-check.adapter.ts';
import { sessionEditAccess } from './session-edit-access.adapter.ts';
import { sessionPlace } from './session-place.adapter.ts';

const RETRYABLE_SQLSTATE = new Set(['40P01', '40001', '55P03']);
const EDIT_OPERATION = 'edit-service-line-price';

interface LineEditReaders {
  place: LineEditTransaction['place'];
  access: LineEditTransaction['access'];
  editors: LineEditTransaction['editors'];
  performers: LineEditTransaction['performers'];
  discount: LineEditTransaction['discount'];
}

export function createLineEditTransactions(
  database: TenantWrappers,
  bind: (tx: Tx, context: SessionWriteContext) => LineEditReaders,
): LineEditTransactions {
  return { run: (context, work) => runLineEdit(database, bind, context, work) };
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

async function runLineEdit<T>(
  database: TenantWrappers,
  bind: (tx: Tx, context: SessionWriteContext) => LineEditReaders,
  context: SessionWriteContext,
  work: (tx: LineEditTransaction) => Promise<T>,
): Promise<T> {
  try {
    return await database.withTenant(context.companyId, (tx) => work(lineEditTransaction(tx, context, bind(tx, context))), { userId: context.userId });
  } catch (error) {
    return mapLineEditError(error);
  }
}

function lineEditTransaction(tx: Tx, context: SessionWriteContext, readers: LineEditReaders): LineEditTransaction {
  const scope = { companyId: context.companyId, businessId: context.businessId, branchId: context.branchId };
  return {
    ...readers,
    lines: {
      lockVisit: (sessionId) => lockLineEditVisit(tx, sessionId),
      loadLineForUpdate: (sessionId, lineId) => loadLineForUpdate(tx, scope, sessionId, lineId),
      activeNets: (sessionId, exceptLineId) => activeLineNets(tx, scope, sessionId, exceptLineId),
      updateLine: (sessionId, lineId, update) => updateLinePrice(tx, scope, sessionId, lineId, update),
      insertEdit: (sessionId, lineId, edit) => insertLineEdit(tx, scope, sessionId, lineId, edit),
      loadSession: (sessionId) => loadEditableSession(tx, scope, sessionId),
    },
    idempotent: (handler) => claimLineEdit(tx, context, handler),
    audit: (id, entry) => writeLineEditAudit(tx, id, entry),
    emit: (id, sessionId, payload) => appendOutboxEvent(tx, id, {
      aggregateType: 'service_session',
      aggregateId: sessionId,
      eventType: 'ServiceLineChanged',
      payload,
    }),
  };
}

async function claimLineEdit<T>(tx: Tx, context: SessionWriteContext, handler: () => Promise<T>) {
  const result = await runIdempotent(tx, {
    scope: 'COMPANY',
    operation: EDIT_OPERATION,
    key: context.key,
    fingerprint: context.fingerprint,
  }, async () => ({ status: 200, body: await handler() }));
  return { body: result.body as T, replayed: result.replayed };
}

async function writeLineEditAudit(tx: Tx, id: string, entry: LineEditAuditEntry): Promise<void> {
  await appendAuditLogs(tx, [{ id, entry }]);
}

function mapLineEditError(error: unknown): never {
  const seen = new Set<unknown>();
  for (let current = error, depth = 0; typeof current === 'object' && current !== null && !seen.has(current); current = (current as { cause?: unknown }).cause, depth += 1) {
    seen.add(current);
    if (current instanceof SessionError || current instanceof IdempotencyKeyBusyError) throw current;
    if (depth === 0 && current instanceof IdempotencyKeyReusedError) throw new SessionError('IDEMPOTENCY_KEY_REUSED');
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && RETRYABLE_SQLSTATE.has(code)) throw new SessionError('TRANSACTION_RETRY_REQUIRED');
  }
  throw error;
}
