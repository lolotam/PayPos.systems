import { readBusinessIdentity, type Tx } from '@pospay/db';

import type { StatementLogoReferenceReader } from '../ports/attendance-statement.port.ts';

export function createStatementLogoReferenceReader(
  tx: Tx,
  companyId: string,
): StatementLogoReferenceReader {
  return {
    read: async (businessId) =>
      (await readBusinessIdentity(tx, companyId, businessId)).logo_file_id,
  };
}
