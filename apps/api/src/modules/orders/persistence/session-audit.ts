import { appendAuditLogs, type Tx, type IdGenerator } from '@pospay/db';
import { sessionAuditEntries } from '../domain/session-audit.ts';
import type { SessionLine, SessionRecord } from '../domain/session-types.ts';

export async function auditSession(tx: Tx, ids: IdGenerator, record: SessionRecord, added: readonly SessionLine[], outcome: 'COMPLETE' | 'PARTIAL', append: boolean) {
  await appendAuditLogs(tx, sessionAuditEntries(record, added, outcome, append).map((entry) => ({ id: ids.newId(), entry })));
}
