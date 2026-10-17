import type { Tx } from '@pospay/db';
import { employeeNamesByUser } from '../../staff/index.ts';
import type { EditorNamePort } from '../ports/line-edit.port.ts';

export function editorName(tx: Tx, companyId: string, businessId: string): EditorNamePort {
  return { read: (userId) => employeeNamesByUser(tx, companyId, businessId, userId) };
}
