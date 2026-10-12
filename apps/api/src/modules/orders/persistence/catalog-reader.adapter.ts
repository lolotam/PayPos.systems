import type { Tx } from '@pospay/db';
import { parseMoney } from '@pospay/domain';
import { readSessionServices } from '../../catalog/index.ts';
import type { CatalogReaderPort } from '../ports/session-readers.port.ts';
import type { SessionRule } from '../domain/session-types.ts';

export function catalogReader(tx: Tx, companyId: string, businessId: string): CatalogReaderPort {
  return {
    lock: async (ids) => { await readSessionServices(tx, companyId, businessId, ids, true); },
    read: async (ids) => (await readSessionServices(tx, companyId, businessId, ids)).map((row) => {
      let rule: SessionRule;
      switch (row.rule.kind) {
        case 'FOLLOW_PLAN': rule = { kind: 'FOLLOW_PLAN' }; break;
        case 'ZERO': rule = { kind: 'ZERO' }; break;
        case 'PCT': rule = { kind: 'PCT', value: row.rule.value }; break;
        case 'FIXED': rule = { kind: 'FIXED', value: parseMoney(row.rule.value) }; break;
        default: { const unreachable: never = row.rule; throw new Error(`Invalid rule ${unreachable}`); }
      }
      return { ...row, price: parseMoney(row.price), rule };
    }),
  };
}
