import { readBusinessIdentity, type Tx } from '@pospay/db';
import type { StatementIdentityReader } from '../ports/attendance-statement.port.ts';

/**
 * قارئ هوية النشاط: الجملة المشتركة في @pospay/db، عشان البيان والتقرير يقراوا نفس المصدر.
 */
export const statementIdentityReader: StatementIdentityReader<Tx> = {
  read: (tx, companyId, businessId) => readBusinessIdentity(tx, companyId, businessId),
};
