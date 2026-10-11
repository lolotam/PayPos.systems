import { appendAuditLog, type IdGenerator, type Tx } from '@pospay/db';
import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';

export function createAttendanceReportAudit(ids: IdGenerator) {
  return (tx: Tx): AuditTrail => ({ record: (entry) => appendAuditLog(tx, ids.newId(), entry) });
}
