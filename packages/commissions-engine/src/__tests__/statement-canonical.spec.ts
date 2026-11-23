import { describe, expect, it } from 'vitest';

import { buildStatement } from '../statement-builder.ts';
import {
  statementAttachmentFromStored,
  statementFingerprintInput,
  statementRowFromStored,
  type StoredStatementAttachment,
  type StoredStatementLine,
} from '../statement-fingerprint.ts';
import type { StatementBuildInput } from '../statement-types.ts';
import { at, HAWALLI, octoberInput, octoberRows, SALMIYA, SARA } from './statement-fixtures.ts';

/** أعمدة بتبدأ null في كل صف، ومكتوبة يدويًا هنا مش مشتقة من الباني. */
const NULLS = {
  previous_amount: null,
  new_amount: null,
  source_period: null,
  source_branch_id: null,
  source_branch_name_ar: null,
  source_branch_name_en: null,
  source_business_date: null,
  line_id: null,
  session_id: null,
  service_id: null,
  service_name_ar: null,
  service_name_en: null,
  customer_id: null,
  customer_name: null,
  business_date: null,
};

const SARA_CARD = {
  employee_id: SARA,
  employee_number: 1,
  employee_name_ar: 'سارة',
  employee_name_en: 'Sara',
};

/** تفاصيل بند التصحيح القديم، وهي اللي بتفرق "التفاصيل موجودة" عن "غايبة". */
const OLD_LINE_DETAIL = {
  line_id: 'old-1',
  session_id: 'session-old',
  service_id: 'service-1',
  service_name_ar: 'قص',
  service_name_en: 'Cut',
  customer_id: 'customer-1',
  customer_name: 'Customer One',
  business_date: '2026-09-28',
};

/** حقول التفاصيل كلها null، وهي الحالة اللي رأس إسقاط بندها غايب. */
const DETAIL_ABSENT = {
  line_id: null,
  session_id: null,
  service_id: null,
  service_name_ar: null,
  service_name_en: null,
  customer_id: null,
  customer_name: null,
  business_date: null,
};

const CORRECTION_ROW = {
  ...NULLS,
  ...SARA_CARD,
  ...OLD_LINE_DETAIL,
  source_ref: 'correction:correction-1',
  kind: 'CORRECTION',
  amount: '3.000',
  previous_amount: '0.000',
  new_amount: '3.000',
  source_period: '2026-09',
  source_branch_id: SALMIYA,
  source_branch_name_ar: 'السالمية',
  source_branch_name_en: 'Salmiya',
  source_business_date: '2026-09-28',
  attached_branch_ids: [SALMIYA],
};

const EMPLOYEE_ROW = {
  ...NULLS,
  ...SARA_CARD,
  source_ref: `employee:${SARA}`,
  kind: 'EMPLOYEE',
  amount: '0.000',
  attached_branch_ids: [HAWALLI, SALMIYA],
};

const LINE_ROW = {
  ...NULLS,
  ...SARA_CARD,
  source_ref: 'line:line-1',
  kind: 'COMMISSION',
  amount: '5.000',
  source_branch_id: SALMIYA,
  source_branch_name_ar: 'السالمية',
  source_branch_name_en: 'Salmiya',
  source_business_date: '2026-10-05',
  attached_branch_ids: [SALMIYA],
  line_id: 'line-1',
  session_id: 'session-1',
  service_id: 'service-1',
  service_name_ar: 'قص',
  service_name_en: 'Cut',
  customer_id: 'customer-1',
  customer_name: 'Customer One',
  business_date: '2026-10-05',
};

/** القيمة القياسية اللي بصمة الكشف بتتحسب منها، مكتوبة باليد: ترتيب (الموظفة، المصدر) والمرفقات. */
const EXPECTED = {
  lines: [CORRECTION_ROW, EMPLOYEE_ROW, LINE_ROW],
  attachments: [
    {
      employee_id: SARA,
      branch_id: HAWALLI,
      attached_from: '2026-10-15',
      attached_to: '2026-10-31',
    },
    {
      employee_id: SARA,
      branch_id: SALMIYA,
      attached_from: '2026-10-01',
      attached_to: '2026-10-14',
    },
  ],
};

/** شهر صغير لسارة: بند واحد بـ 5% على 100.000 وتصحيح مستلم واحد، ونقلة من السالمية لحولي يوم 15. */
function smallInput(): StatementBuildInput {
  const rows = octoberRows();
  const month = {
    ...rows,
    lines: [at(rows.lines, 0)],
    sales: [],
    tips: [],
    overrides: [],
    carries: [],
  };
  const input = octoberInput(month);
  return { ...input, employees: [at(input.employees, 0)] };
}

/** نفس الشهر الصغير لكن الصفوف كما بترجع من القاعدة: نصوص، وuuid[] بترتيب معكوس، وأعمدة زيادة. */
function storedRows(): Array<StoredStatementLine & Record<string, unknown>> {
  const extra = { id: 'row', statement_id: 'statement-oct', company_id: 'c', business_id: 'b' };
  return [LINE_ROW, EMPLOYEE_ROW, CORRECTION_ROW].map((row) => ({
    ...extra,
    ...row,
    kind: row.kind as StoredStatementLine['kind'],
    attached_branch_ids: [...row.attached_branch_ids].reverse(),
  }));
}

const STORED_ATTACHMENTS: StoredStatementAttachment[] = [
  { employee_id: SARA, branch_id: SALMIYA, attached_from: '2026-10-01', attached_to: '2026-10-14' },
  { employee_id: SARA, branch_id: HAWALLI, attached_from: '2026-10-15', attached_to: '2026-10-31' },
];

describe('the canonical statement value', () => {
  it('is what the builder produces for the small month', () => {
    const build = buildStatement(smallInput());
    expect(statementFingerprintInput(build.rows, build.attachments)).toEqual(EXPECTED);
  });

  it('is what the hand-typed rows read back from the database produce', () => {
    const readBack = statementFingerprintInput(
      storedRows().map(statementRowFromStored),
      STORED_ATTACHMENTS.map(statementAttachmentFromStored),
    );
    expect(readBack).toEqual(EXPECTED);
  });
});

describe('a single frozen column moves the canonical value', () => {
  it('moves when only the previous amount of the correction changes, in the builder', () => {
    const input = smallInput();
    const month = {
      ...input.month,
      corrections: [{ ...at(input.month.corrections, 0), previousAmount: 1_000n }],
    };
    const build = buildStatement({ ...input, month });
    expect(statementFingerprintInput(build.rows, build.attachments)).toEqual({
      ...EXPECTED,
      lines: [{ ...CORRECTION_ROW, previous_amount: '1.000' }, EMPLOYEE_ROW, LINE_ROW],
    });
  });

  it('moves when only the previous amount of the correction changes, in the stored rows', () => {
    const rows = storedRows().map((row) =>
      row.kind === 'CORRECTION' ? { ...row, previous_amount: '1.000' } : row,
    );
    const readBack = statementFingerprintInput(
      rows.map(statementRowFromStored),
      STORED_ATTACHMENTS.map(statementAttachmentFromStored),
    );
    expect(readBack).not.toEqual(EXPECTED);
    expect(readBack.lines).toEqual([
      { ...CORRECTION_ROW, previous_amount: '1.000' },
      EMPLOYEE_ROW,
      LINE_ROW,
    ]);
  });

  it('tells a correction with its line detail from one without it', () => {
    const input = { ...smallInput(), correctionLineDetails: new Map() };
    const build = buildStatement(input);
    const absent = { ...CORRECTION_ROW, ...DETAIL_ABSENT };
    const value = statementFingerprintInput(build.rows, build.attachments);
    expect(value.lines).toEqual([absent, EMPLOYEE_ROW, LINE_ROW]);
    expect(value).not.toEqual(EXPECTED);
  });
});
