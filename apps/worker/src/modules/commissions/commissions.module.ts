import type { TenantWrappers } from '@pospay/db';

import { commissionStatementExportTransactions } from './persistence/commission-statement-export.transactions.ts';
import type { CommissionBranchNamesReader } from './ports/commission-branch-names.port.ts';
import type { CommissionStatementExportData } from './ports/commission-statement-export.port.ts';
import {
  commissionStatementExportRequestStatement,
  commissionStatementFrozenRowsStatement,
} from './queries/commission-statement-export.query.ts';
import { ReadCommissionStatementExport } from './use-cases/read-commission-statement-export/read-commission-statement-export.ts';

/** قارئ تصدير كشف العمولة في الـ worker؛ مصنع مستقل عن طوابير وظائف العمولات. */
export function createCommissionStatementExportReader(
  database: Pick<TenantWrappers, 'withTenant'>,
  branchNames: CommissionBranchNamesReader,
) {
  const useCase = new ReadCommissionStatementExport(
    commissionStatementExportTransactions(
      database,
      {
        request: commissionStatementExportRequestStatement,
        rows: commissionStatementFrozenRowsStatement,
      },
      branchNames,
    ),
  );
  return (
    companyId: string,
    renderId: string,
    signal?: AbortSignal,
  ): Promise<CommissionStatementExportData> => useCase.execute(companyId, renderId, signal);
}
