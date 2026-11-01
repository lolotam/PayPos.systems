import type { IdGenerator, Tx } from '@pospay/db';

import type { CommissionServiceReaderPort } from '../ports/commission-service-reader.port.ts';
import type {
  CommissionServiceOverrideScope,
  CreateCommissionServiceOverrideCommand,
} from '../ports/commission-service-override-transactions.port.ts';
import {
  createCommissionInputLockScope,
  type CommissionInputLockReaders,
} from './commission-input-lock-scope.ts';
import {
  auditCommissionServiceOverride,
  insertCommissionServiceOverride,
} from './commission-service-override-writer.ts';

/** قراء التجاوز: قارئ القفل المشترك وقارئ وجود الخدمة. */
export interface CommissionServiceOverrideReaders extends CommissionInputLockReaders {
  readonly serviceReader: CommissionServiceReaderPort['exists'];
}

export function createCommissionServiceOverrideScope(
  tx: Tx,
  command: CreateCommissionServiceOverrideCommand,
  ids: IdGenerator,
  readers: CommissionServiceOverrideReaders,
): CommissionServiceOverrideScope {
  return {
    ...createCommissionInputLockScope(tx, command, ids, readers),
    serviceExists: () =>
      readers.serviceReader(
        tx,
        command.companyId,
        command.businessId,
        command.input.service_id,
      ),
    insert: (record) =>
      insertCommissionServiceOverride(tx, command.companyId, command.businessId, record),
    audit: (record) => auditCommissionServiceOverride(tx, ids, record),
  };
}
