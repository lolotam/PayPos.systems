import { buildCanonicalInput } from '../canonical-input.ts';
import { edit, type FieldMutation } from './canonical-input-mutation-editor.ts';
import { fullRows } from './canonical-input-expected.ts';
import { PERIOD } from './statement-fixtures.ts';

/**
 * تعديلات البنود؛ وقاعدة البند بتتنقل بين نوع بقيمة ونوع بلا قيمة (ZERO وFOLLOW_PLAN) والعكس.
 *
 * @returns التعديلات
 */
export function lineMutations(): FieldMutation[] {
  const L = 'employees[].lines[].';
  const kind = `${L}rule_snapshot.kind`;
  const value = ['rule_snapshot.value'];
  return [
    edit('employees[].employee_id', 'lines', 0, { employeeId: 'employee-zed' }, { moves: true }),
    edit(`${L}line_id`, 'lines', 0, { lineId: 'line-1b' }),
    edit(`${L}revision`, 'lines', 0, { revision: 5n }),
    edit(`${L}occurred_at`, 'lines', 0, { occurredAt: 1_790_000_000_000_009n }),
    edit(`${L}recorded_at`, 'lines', 0, { recordedAt: 1_790_000_000_000_009n }),
    edit(`${L}business_date`, 'lines', 0, { businessDate: '2026-10-06' }),
    edit(`${L}service_id`, 'lines', 0, { serviceId: 'service-9' }),
    edit(`${L}net_share`, 'lines', 0, { netShare: 100_001n }),
    edit(`${L}share_bps`, 'lines', 0, { shareBps: 9_999n }),
    edit(`${L}counts`, 'lines', 0, { counts: false }),
    edit(
      kind,
      'lines',
      0,
      { ruleSnapshot: { kind: 'FIXED', value: 500n } },
      { alsoChanges: value, label: 'PCT to FIXED' },
    ),
    edit(
      kind,
      'lines',
      0,
      { ruleSnapshot: { kind: 'ZERO' } },
      { alsoChanges: value, label: 'PCT to ZERO, the value goes' },
    ),
    edit(
      kind,
      'lines',
      1,
      { ruleSnapshot: { kind: 'PCT', value: 500n } },
      { alsoChanges: value, label: 'FOLLOW_PLAN to PCT, a value appears' },
    ),
    edit(`${L}rule_snapshot.value`, 'lines', 0, { ruleSnapshot: { kind: 'PCT', value: 501n } }),
  ];
}

/**
 * تعديلات البيع والبقشيش والراتب. المعرّفات بتتبدّل لقيمة بتفضل في نفس موضع الترتيب، وطريقة دفع
 * البقشيش بتتعدّل في بقشيش جلسته الوحيدة.
 *
 * @returns التعديلات
 */
export function saleTipSalaryMutations(): FieldMutation[] {
  const S = 'employees[].sales[].';
  const T = 'employees[].tips[].';
  const salary = 'employees[].salary';
  return [
    edit(`${S}sale_id`, 'sales', 0, { saleId: 'sale-1b' }),
    edit(`${S}revision`, 'sales', 0, { revision: 7n }),
    edit(`${S}business_date`, 'sales', 0, { businessDate: '2026-10-11' }),
    edit(`${S}price_paid`, 'sales', 0, { pricePaid: 50_001n }),
    edit(`${S}refunded_amount`, 'sales', 0, { refundedAmount: 10_001n }),
    edit(`${T}session_id`, 'tips', 0, { sessionId: 'session-0' }),
    edit(`${T}revision`, 'tips', 0, { revision: 2n }),
    edit(`${T}method`, 'tips', 2, { method: 'CASH' }),
    edit(`${T}business_date`, 'tips', 0, { businessDate: '2026-10-06' }),
    edit(`${T}amount`, 'tips', 0, { amount: 6_001n }),
    {
      ...edit(
        salary,
        'salaries',
        0,
        {},
        { alsoChanges: ['salary.effective_from', 'salary.revision'] },
      ),
      ids: ['employee-noor'],
      run: () => {
        const rows = fullRows();
        const extra = {
          employeeId: 'employee-noor',
          effectiveFrom: '2026-10-01',
          amount: 1n,
          revision: 1n,
        };
        return JSON.stringify(
          buildCanonicalInput(PERIOD, { ...rows, salaries: [...rows.salaries, extra] }),
        );
      },
    },
    edit(`${salary}.effective_from`, 'salaries', 0, { effectiveFrom: '2026-10-02' }),
    edit(`${salary}.revision`, 'salaries', 0, { revision: 4n }),
  ];
}
