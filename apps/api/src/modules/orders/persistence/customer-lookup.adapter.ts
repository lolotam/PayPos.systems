import type { Tx } from '@pospay/db';
import { readSessionCustomer } from '../../customers/index.ts';
import type { CustomerLookupPort } from '../ports/session-readers.port.ts';
export function customerLookup(tx: Tx, companyId: string): CustomerLookupPort {
  return { read: (id) => readSessionCustomer(tx, companyId, id) };
}
