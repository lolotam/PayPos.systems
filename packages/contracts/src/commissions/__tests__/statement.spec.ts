import { describe, expect, it } from 'vitest';

import { buildOpenApiDocument } from '../../openapi.js';
import {
  commissionStatementBranchView,
  commissionStatementEmployee,
  commissionStatementRow,
  commissionStatementView,
} from '../statement.js';

const FINGERPRINT = 'a'.repeat(64);

const employee = {
  employee_id: '01920000-0000-7000-8000-0000000000e1',
  employee_number: 7,
  name_ar: null,
  name_en: 'Rana',
  partial: false,
  departed: false,
  commission_subtotal: '-3.000',
  tip_side: '2.500',
  payable: '2.500',
  rows: [
    {
      source_ref: 'line:01920000-0000-7000-8000-0000000000d5',
      kind: 'COMMISSION' as const,
      amount: '4.000',
      previous_amount: null,
      new_amount: null,
      source_period: null,
      source_branch_id: '01920000-0000-7000-8000-0000000000b1',
      source_branch_name_ar: null,
      source_branch_name_en: 'Salmiya',
      source_business_date: '2026-10-15',
      service_name_ar: null,
      service_name_en: 'Manicure',
      customer_name: 'Layla Ahmad',
      business_date: '2026-10-15',
    },
  ],
  issues: [{ kind: 'BLOCKED_CORRECTION' as const, code: 'NO_PLAN' as const, source_period: '2026-09' }],
};

const businessView = {
  reader_scope: 'BUSINESS' as const,
  business_id: '01920000-0000-7000-8000-0000000000a1',
  period: '2026-10',
  status: 'REVIEWED' as const,
  generated: true,
  current_fingerprint: FINGERPRINT,
  current_statement_fingerprint: FINGERPRINT,
  reviewed_fingerprint: FINGERPRINT,
  reviewed_statement_fingerprint: FINGERPRINT,
  changed_since_review: false,
  change_cause: null,
  employees: [employee],
};

const branchView = {
  reader_scope: 'BRANCHES' as const,
  business_id: businessView.business_id,
  period: '2026-10',
  status: 'DRAFT' as const,
  generated: false,
  employees: [employee],
};

describe('the business-wide statement view', () => {
  it('carries both current fingerprints, the reviewed ones and the change flag with its cause', () => {
    expect(commissionStatementView.safeParse(businessView).success).toBe(true);
    expect(
      commissionStatementView.safeParse({
        ...businessView,
        changed_since_review: true,
        change_cause: 'STATEMENT',
      }).success,
    ).toBe(true);
  });

  it('requires every whole-statement field, not an optional subset of them', () => {
    for (const field of [
      'current_fingerprint',
      'current_statement_fingerprint',
      'reviewed_fingerprint',
      'reviewed_statement_fingerprint',
      'changed_since_review',
      'change_cause',
    ]) {
      const rest = Object.fromEntries(
        Object.entries(businessView).filter(([key]) => key !== field),
      );
      expect(commissionStatementView.safeParse(rest).success).toBe(false);
    }
  });

  it('refuses a fingerprint that is not 64 lowercase hex characters', () => {
    expect(
      commissionStatementView.safeParse({ ...businessView, current_fingerprint: 'A'.repeat(64) })
        .success,
    ).toBe(false);
    expect(
      commissionStatementView.safeParse({ ...businessView, current_fingerprint: 'abc' }).success,
    ).toBe(false);
  });

  it('refuses a month that is already closed: only DRAFT and REVIEWED exist on the wire', () => {
    expect(commissionStatementView.safeParse({ ...businessView, status: 'APPROVED' }).success).toBe(
      false,
    );
  });
});

describe('the branch-scoped statement view (CM-28c)', () => {
  it('has the status and rows only', () => {
    expect(commissionStatementBranchView.safeParse(branchView).success).toBe(true);
    expect(Object.keys(commissionStatementBranchView.shape).sort()).toEqual(
      ['business_id', 'employees', 'generated', 'period', 'reader_scope', 'status'].sort(),
    );
  });

  it('does not accept the business discriminator, so the two shapes cannot be mixed up', () => {
    expect(
      commissionStatementBranchView.safeParse({ ...branchView, reader_scope: 'BUSINESS' }).success,
    ).toBe(false);
    expect(
      commissionStatementView.safeParse({ ...businessView, reader_scope: 'BRANCHES' }).success,
    ).toBe(false);
  });
});

describe('a statement employee row', () => {
  it('accepts a negative subtotal and refuses an amount that is not three decimals', () => {
    expect(commissionStatementEmployee.safeParse(employee).success).toBe(true);
    expect(
      commissionStatementEmployee.safeParse({ ...employee, payable: '2.5' }).success,
    ).toBe(false);
  });

  it('has no phone, session or line identity on a row', () => {
    const keys = Object.keys(commissionStatementRow.shape);
    expect(keys.filter((key) => /phone|session|line_id|customer_id/.test(key))).toEqual([]);
  });
});

describe('the statement routes in the OpenAPI document', () => {
  it('documents the read as a oneOf of the open and closed shapes and the generate as the business shape', () => {
    const document = buildOpenApiDocument() as {
      paths: Record<string, Record<string, { responses: Record<string, { content?: unknown }> }>>;
    };
    const base = '/v1/businesses/{businessId}/commission-statements/{period}';
    expect(document.paths[base]?.['get']?.responses['200']?.content).toEqual({
      'application/json': {
        schema: {
          oneOf: [
            { $ref: '#/components/schemas/CommissionStatementView' },
            { $ref: '#/components/schemas/CommissionStatementBranchView' },
            { $ref: '#/components/schemas/CommissionClosedStatementView' },
            { $ref: '#/components/schemas/CommissionClosedStatementBranchView' },
          ],
        },
      },
    });
    expect(document.paths[`${base}/generate`]?.['post']?.responses['200']?.content).toEqual({
      'application/json': { schema: { $ref: '#/components/schemas/CommissionStatementView' } },
    });
  });
});
