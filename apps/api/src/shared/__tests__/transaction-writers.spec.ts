import type { Tx } from '@pospay/db';
import { describe, expect, it } from 'vitest';

import { transactionWriters } from '../adapters/transaction-writers.ts';

// The database behaviour of these writers is proven in packages/db against Postgres; this checks the
// binding: every call goes into the one transaction it was built with, each with a fresh generated id.
describe('transactionWriters', () => {
  it('writes the event and the audit record into the bound transaction with fresh ids', async () => {
    const statements: unknown[] = [];
    const tx = { execute: async (query: unknown) => statements.push(query) } as unknown as Tx;
    let next = 0;
    const ids = { newId: () => `01960000-0000-7000-8000-00000000000${++next}` };
    const { outbox, audit } = transactionWriters(tx, ids);

    await outbox.append({
      aggregateType: 'business',
      aggregateId: '01960000-0000-7000-8000-0000000000aa',
      eventType: 'BusinessCreated',
      payload: {},
    });
    await audit.record({
      entity: 'business',
      entityId: '01960000-0000-7000-8000-0000000000aa',
      action: 'created',
    });

    expect(statements).toHaveLength(2);
    expect(next).toBe(2);
  });
});
