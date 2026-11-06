import { expect, it } from 'vitest';
import { createPackageSlots, parseMoney } from '@pospay/domain';
import {
  packageCommitRows,
  packageCommitCounts,
  countCreatedPackageImports,
  type PackageCommitPreview,
} from '../package-import-commit.ts';
const component = {
  service_id: 'service',
  sessions: 3,
  remaining: 1,
  list_price_snapshot: '99.000',
  component_value: '10.001',
  base_unit_value: '3.333',
  last_unit_value: '3.335',
};
function preview(): PackageCommitPreview {
  return {
    id: 'preview',
    business_id: 'business',
    created_by: 'user',
    commit_membership_id: 'accepted',
    requested_at: '2026-01-01T00:00:00Z',
    expires_at: '2026-01-02T00:00:00Z',
    row_count: 2,
    error_count: 0,
    skipped_count: 1,
    source_rows: [502, 2],
    skipped_rows: [2],
    errors: [],
    rows: [
      {
        row: 502,
        customer_id: 'customer',
        phone_last3: '123',
        name_en: 'Package',
        name_ar: null,
        price_paid: '10.001',
        expires_on: '2020-01-01',
        external_ref: 'ref',
        components: [component],
      },
    ],
  };
}
it('uses dense sorted source positions including skipped rows and physical 502', () => {
  expect(packageCommitRows(preview())[0]?.import_row).toBe(2);
});
it('supports dense positions 1 and 500 with gaps in physical rows', () => {
  const p = preview();
  const source = Array.from({ length: 500 }, (_, i) => (i === 499 ? 502 : i + 2));
  const last = p.rows[0];
  if (!last) throw new Error('fixture');
  expect(
    packageCommitRows({
      ...p,
      row_count: 500,
      source_rows: source,
      skipped_count: 499,
      skipped_rows: source.slice(0, -1),
    })[0]?.import_row,
  ).toBe(500);
  expect(
    packageCommitRows({ ...p, rows: [{ ...last, row: 2 }], skipped_rows: [502] })[0]?.import_row,
  ).toBe(1);
});
it('preserves exact remainder and imported used ordinals', () => {
  const row = packageCommitRows(preview())[0];
  expect(row).toBeDefined();
  expect(createPackageSlots(10001n, 3, 1, { base: 3333n, last: 3335n })).toEqual([
    { ordinal: 1, unitValue: 3333n, state: 'IMPORTED_USED' },
    { ordinal: 2, unitValue: 3333n, state: 'IMPORTED_USED' },
    { ordinal: 3, unitValue: 3335n, state: 'FREE' },
  ]);
});
it('accepts zero price and puts remainder only on final component', () => {
  const p = preview();
  const r = p.rows[0];
  if (!r) throw new Error('fixture');
  const zero = {
    ...component,
    component_value: '0.000',
    base_unit_value: '0.000',
    last_unit_value: '0.000',
  };
  expect(
    packageCommitRows({ ...p, rows: [{ ...r, price_paid: '0.000', components: [zero] }] }),
  ).toHaveLength(1);
  const a = {
    ...component,
    sessions: 1,
    remaining: 0,
    component_value: '3.333',
    last_unit_value: '3.333',
  };
  const b = {
    ...component,
    service_id: 'second',
    sessions: 2,
    remaining: 2,
    component_value: '6.668',
  };
  expect(packageCommitRows({ ...p, rows: [{ ...r, components: [a, b] }] })).toHaveLength(1);
  expect(parseMoney(a.component_value) + parseMoney(b.component_value)).toBe(10001n);
});
it.each([
  'legacy',
  'overlap',
  'omitted',
  'duplicate',
  'identity',
  'expired',
  'money',
  'remaining',
  'errors',
])('rejects %s safely', (scenario) => {
  const p = preview();
  const r = p.rows[0];
  if (!r) throw new Error('fixture');
  const changed = { ...p };
  if (scenario === 'legacy') changed.source_rows = null;
  if (scenario === 'overlap') changed.skipped_rows = [502];
  if (scenario === 'omitted') changed.source_rows = [2];
  if (scenario === 'duplicate') changed.source_rows = [502, 502];
  if (scenario === 'identity') changed.commit_membership_id = null;
  if (scenario === 'expired') changed.requested_at = p.expires_at;
  if (scenario === 'money')
    changed.rows = [{ ...r, components: [{ ...component, last_unit_value: '3.334' }] }];
  if (scenario === 'remaining')
    changed.rows = [{ ...r, components: [{ ...component, remaining: 4 }] }];
  if (scenario === 'errors') changed.errors = [{}];
  expect(() => packageCommitRows(changed)).toThrow(/^IMPORT_/);
});
it('all skipped succeeds with final counts without changing proof', () => {
  const p = { ...preview(), rows: [], skipped_count: 2, skipped_rows: [2, 502] };
  expect(packageCommitRows(p)).toEqual([]);
  expect(packageCommitCounts(2, 0)).toEqual({ created_count: 0, skipped_count: 2 });
});

it.each([
  { rows: 5, outcomes: [true, false, true], created: 2, skipped: 3 },
  { rows: 2, outcomes: [], created: 0, skipped: 2 },
  { rows: 2, outcomes: [false, false], created: 0, skipped: 2 },
  { rows: 500, outcomes: Array<boolean>(500).fill(true), created: 500, skipped: 0 },
])(
  'counts successful inserts including prior skips and conflicts: $created/$skipped',
  ({ rows, outcomes, created, skipped }) => {
    const count = countCreatedPackageImports(Object.freeze(outcomes));
    expect(packageCommitCounts(rows, count)).toEqual({
      created_count: created,
      skipped_count: skipped,
    });
  },
);
