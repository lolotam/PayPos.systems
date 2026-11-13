import { lockStatementPeriods } from '@pospay/db';
import { expect, it } from 'vitest';

import { expectPgError } from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import { createCommissionCorrectionScope } from '../persistence/commission-correction.scope.ts';
import {
  A,
  clock,
  db,
  draft,
  EVENT_ID,
  ids,
  inScope,
  owner,
  SOURCE_PERIOD,
  SOURCE_REF,
  sourceStatementId,
  TARGET_PERIOD,
  targetStatementId,
} from './commission-correction-db.harness.ts';

it('reads the frozen sources of the source statement with their copied attribution', async () => {
  const frozen = await inScope((scope) =>
    scope.readFrozenSources({
      businessId: A.business,
      statementId: sourceStatementId,
      employeeId: A.employee,
    }),
  );
  expect(frozen).toEqual([
    {
      sourceRef: SOURCE_REF,
      kind: 'COMMISSION',
      amount: 20_000n,
      attribution: {
        sourceBranchId: A.branch,
        sourceBusinessDate: '2026-10-15',
        attachedBranchIds: [A.branch],
      },
    },
  ]);
});

it('reads the frozen attachment snapshot of the source statement', async () => {
  const snapshot = await inScope((scope) =>
    scope.readAttachmentSnapshot({
      businessId: A.business,
      statementId: sourceStatementId,
      employeeId: A.employee,
    }),
  );
  expect(snapshot).toEqual([
    { branchId: A.branch, attachedFrom: '2026-10-01', attachedTo: '2026-10-31' },
  ]);
});

it('bumps the generation from one to two across transactions', async () => {
  const first = await inScope((scope) =>
    scope.bumpGeneration({
      businessId: A.business,
      employeeId: A.employee,
      period: SOURCE_PERIOD,
    }),
  );
  const second = await inScope((scope) =>
    scope.bumpGeneration({
      businessId: A.business,
      employeeId: A.employee,
      period: SOURCE_PERIOD,
    }),
  );
  expect(first).toBe(1);
  expect(second).toBe(2);
});

it('gives every concurrent correction its own generation under the statement lock', async () => {
  const run = async (): Promise<number> =>
    db.withTenant(A.company, async (tx) => {
      await lockStatementPeriods(tx, { businessId: A.business, periods: [SOURCE_PERIOD], ids });
      const scope = createCommissionCorrectionScope(tx, ids, clock);
      return scope.bumpGeneration({
        businessId: A.business,
        employeeId: A.employee,
        period: SOURCE_PERIOD,
      });
    });
  const generations = await Promise.all([run(), run()]);
  expect([...generations].sort((left, right) => left - right)).toEqual([1, 2]);
});

it('writes the correction row and reads it back as a posted correction', async () => {
  await inScope((scope) => scope.insertCorrections({ businessId: A.business, drafts: [draft()] }));
  const [row] = await owner`SELECT employee_id, source_period, target_period, target_statement_id,
    source_ref, kind, amount::text AS amount, previous_amount::text AS previous_amount,
    new_amount::text AS new_amount, generation, event_id,
    to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
    source_branch_id, source_business_date::text AS source_business_date, attached_branch_ids
    FROM commission_corrections WHERE source_ref=${SOURCE_REF}`;
  expect(row).toMatchObject({
    employee_id: A.employee,
    source_period: SOURCE_PERIOD,
    target_period: TARGET_PERIOD,
    target_statement_id: targetStatementId,
    source_ref: SOURCE_REF,
    kind: 'COMMISSION',
    amount: '5.000',
    previous_amount: '20.000',
    new_amount: '25.000',
    generation: 1,
    event_id: EVENT_ID,
    created_at: '2026-11-01T09:00:00.000Z',
    source_branch_id: A.branch,
    source_business_date: '2026-10-15',
    attached_branch_ids: [A.branch],
  });
  const posted = await inScope((scope) =>
    scope.readPostedCorrections({
      businessId: A.business,
      employeeId: A.employee,
      sourcePeriod: SOURCE_PERIOD,
    }),
  );
  expect(posted).toEqual([
    {
      sourceRef: SOURCE_REF,
      kind: 'COMMISSION',
      amount: 5_000n,
      attribution: {
        sourceBranchId: A.branch,
        sourceBusinessDate: '2026-10-15',
        attachedBranchIds: [A.branch],
      },
    },
  ]);
});

it('writes nothing when the draft list is empty', async () => {
  await inScope((scope) => scope.insertCorrections({ businessId: A.business, drafts: [] }));
  const rows = await owner`SELECT count(*)::int AS total FROM commission_corrections`;
  expect(rows[0]?.total).toBe(0);
});

it('refuses a duplicate source in the same generation', async () => {
  await expectPgError(
    inScope((scope) =>
      scope.insertCorrections({ businessId: A.business, drafts: [draft(), draft()] }),
    ),
    '23505',
    'commission_corrections_source_key',
  );
});
