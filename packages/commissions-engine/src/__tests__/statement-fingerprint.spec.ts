import { describe, expect, it } from 'vitest';

import { buildStatement } from '../statement-builder.ts';
import {
  statementAttachmentFromStored,
  statementFingerprintInput,
  statementRowFromStored,
  type StoredStatementAttachment,
  type StoredStatementLine,
} from '../statement-fingerprint.ts';
import type { StatementBuild, StatementBuildInput, StatementRow } from '../statement-types.ts';
import { at, HAWALLI, octoberInput, SALMIYA } from './statement-fixtures.ts';

const text = (build: StatementBuild): string =>
  JSON.stringify(statementFingerprintInput(build.rows, build.attachments));

const BASE = text(buildStatement(octoberInput()));

/**
 * صف زي ما بيرجع من قاعدة البيانات بعد التجميد: أعمدة snake_case مكتوبة يدوياً هنا (مش مشتقة من
 * الباني)، مع الأعمدة اللي ما تدخلش البصمة، و`uuid[]` بترتيب معكوس.
 */
function frozen(row: StatementRow, index: number): StoredStatementLine & Record<string, unknown> {
  return {
    id: `row-${index}`,
    statement_id: 'statement-oct',
    company_id: 'company',
    business_id: 'business',
    created_at: '2026-11-02T08:00:00.000Z',
    employee_id: row.employeeId,
    employee_number: row.employeeNumber,
    employee_name_ar: row.employeeNameAr,
    employee_name_en: row.employeeNameEn,
    source_ref: row.sourceRef,
    kind: row.kind,
    amount: row.amount,
    previous_amount: row.previousAmount,
    new_amount: row.newAmount,
    source_period: row.sourcePeriod,
    source_branch_id: row.sourceBranchId,
    source_branch_name_ar: row.sourceBranchNameAr,
    source_branch_name_en: row.sourceBranchNameEn,
    source_business_date: row.sourceBusinessDate,
    attached_branch_ids: [...row.attachedBranchIds].reverse(),
    line_id: row.lineId,
    session_id: row.sessionId,
    service_id: row.serviceId,
    service_name_ar: row.serviceNameAr,
    service_name_en: row.serviceNameEn,
    customer_id: row.customerId,
    customer_name: row.customerName,
    business_date: row.businessDate,
  };
}

describe('the statement fingerprint round trip (CM-34e)', () => {
  it('gives the same fingerprint for the built rows and the rows read back as the database returns them', () => {
    const build = buildStatement(octoberInput());
    const storedLines = build.rows.map(frozen).reverse();
    // تفاصيل بند التصحيح لازم تعدّي القراءة سليمة، مش بس تدخل في البصمة.
    const corrected = build.rows.find((row) => row.kind === 'CORRECTION');
    const stored = storedLines.find((line) => line.kind === 'CORRECTION');
    expect(corrected?.customerName).toBe('Customer One');
    expect(stored === undefined ? null : statementRowFromStored(stored)).toEqual(corrected);
    const storedAttachments: StoredStatementAttachment[] = build.attachments
      .map((row) => ({
        employee_id: row.employeeId,
        branch_id: row.branchId,
        attached_from: row.attachedFrom,
        attached_to: row.attachedTo,
      }))
      .reverse();
    const readBack = JSON.stringify(
      statementFingerprintInput(
        storedLines.map(statementRowFromStored),
        storedAttachments.map(statementAttachmentFromStored),
      ),
    );
    expect(readBack).toBe(text(build));
  });

  it('normalizes a money text that the database might print without trailing zeros', () => {
    const build = buildStatement(octoberInput());
    const stored = build.rows.map((row, index) => ({
      ...frozen(row, index),
      amount: row.amount.replace(/0+$/, '').replace(/\.$/, ''),
    }));
    const readBack = statementFingerprintInput(
      stored.map(statementRowFromStored),
      build.attachments,
    );
    expect(JSON.stringify(readBack)).toBe(text(build));
  });

  it('is stable under a shuffle of the built rows', () => {
    const build = buildStatement(octoberInput());
    expect(
      text({
        ...build,
        rows: [...build.rows].reverse(),
        attachments: [...build.attachments].reverse(),
      }),
    ).toBe(BASE);
  });
});

/** كل ما بيتجمّد بيتبصم: تعديل بين المراجعة والاعتماد لازم يحرّك بصمة الكشف (D-6، CM-32b، CM-34e). */
const MOVES: ReadonlyArray<readonly [string, (input: StatementBuildInput) => StatementBuildInput]> =
  [
    [
      'a customer is renamed',
      (i) => ({ ...i, names: { ...i.names, customers: new Map([['customer-1', 'Renamed']]) } }),
    ],
    [
      'a service is renamed',
      (i) => ({
        ...i,
        names: {
          ...i.names,
          services: new Map([
            ['service-1', { nameAr: 'قص', nameEn: 'Trim' }],
            ['service-2', { nameAr: null, nameEn: 'Colour' }],
          ]),
        },
      }),
    ],
    [
      'a branch where the work was done is renamed',
      (i) => ({
        ...i,
        names: {
          ...i.names,
          branches: new Map([
            [SALMIYA, { nameAr: 'السالمية', nameEn: 'Salmiya 2' }],
            [HAWALLI, { nameAr: 'حولي', nameEn: 'Hawalli' }],
          ]),
        },
      }),
    ],
    [
      'an employee is renamed',
      (i) => ({
        ...i,
        employees: [{ ...at(i.employees, 0), nameEn: 'Sarah' }, at(i.employees, 1)],
      }),
    ],
    [
      'an employee is renumbered',
      (i) => ({
        ...i,
        employees: [{ ...at(i.employees, 0), employeeNumber: 9 }, at(i.employees, 1)],
      }),
    ],
    [
      'a branch link is transferred a day later',
      (i) => ({
        ...i,
        attachments: i.attachments.map((a) =>
          a.to === '2026-10-15'
            ? { ...a, to: '2026-10-20' }
            : a.from === '2026-10-15'
              ? { ...a, from: '2026-10-20' }
              : a,
        ),
      }),
    ],
    [
      'a branch link is added',
      (i) => ({
        ...i,
        attachments: [
          ...i.attachments,
          { employeeId: 'employee-noor', branchId: HAWALLI, from: '2026-10-25', to: null },
        ],
      }),
    ],
    [
      'the service of a corrected line changes',
      (i) => ({
        ...i,
        correctionLineDetails: new Map([
          [
            'old-1',
            {
              sessionId: 'session-old',
              serviceId: 'service-2',
              customerId: null,
              businessDate: '2026-09-28',
            },
          ],
        ]),
      }),
    ],
  ];

describe('the statement fingerprint covers every frozen column', () => {
  it.each(MOVES)('moves when %s', (_name, move) => {
    expect(text(buildStatement(move(octoberInput())))).not.toBe(BASE);
  });

  it('moves when an amount changes through an input the rows carry', () => {
    const input = octoberInput();
    const lines = [
      { ...at(input.month.lines, 0), netShare: 110_000n },
      ...input.month.lines.slice(1),
    ];
    expect(text(buildStatement({ ...input, month: { ...input.month, lines } }))).not.toBe(BASE);
  });
});
