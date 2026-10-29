import { expect, it } from 'vitest';

import { commissionStatementExportScope } from '../persistence/commission-statement-export.transactions.ts';

it('reads the saved scope as BUSINESS or BRANCHES', () => {
  expect(commissionStatementExportScope('BUSINESS')).toBe('BUSINESS');
  expect(commissionStatementExportScope('BRANCHES')).toBe('BRANCHES');
});

it('fails closed on any other saved scope instead of exporting the whole business', () => {
  expect(() => commissionStatementExportScope('BRANCH')).toThrow(
    'commission_statement_exports.scope must be BUSINESS or BRANCHES',
  );
  expect(() => commissionStatementExportScope('')).toThrow(
    'commission_statement_exports.scope must be BUSINESS or BRANCHES',
  );
});
