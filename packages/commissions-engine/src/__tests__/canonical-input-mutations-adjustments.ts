import { edit, type FieldMutation } from './canonical-input-mutation-editor.ts';

/**
 * تعديلات التجاوزات والتصحيحات والموقوفة والمرحّلات؛ وقاعدة التجاوز بتتنقل بين نوع بقيمة ونوع
 * بلا قيمة والعكس.
 *
 * @returns التعديلات
 */
export function adjustmentMutations(): FieldMutation[] {
  const O = 'employees[].overrides[].';
  const C = 'employees[].corrections[].';
  const B = 'employees[].blocked_corrections[].';
  const R = 'employees[].carries[].';
  const value = ['rule.value'];
  return [
    edit(`${O}id`, 'overrides', 0, { id: 'override-1b' }),
    edit(`${O}service_id`, 'overrides', 0, { serviceId: 'service-8' }),
    edit(`${O}effective_from`, 'overrides', 0, { effectiveFrom: '2026-10-02' }),
    edit(`${O}created_at`, 'overrides', 0, { createdAt: 1_789_000_000_000_009n }),
    edit(
      `${O}rule.kind`,
      'overrides',
      0,
      { rule: { kind: 'FIXED', value: 1_500n } },
      { alsoChanges: value, label: 'PCT to FIXED' },
    ),
    edit(
      `${O}rule.kind`,
      'overrides',
      0,
      { rule: { kind: 'ZERO' } },
      { alsoChanges: value, label: 'PCT to ZERO, the value goes' },
    ),
    edit(
      `${O}rule.kind`,
      'overrides',
      2,
      { rule: { kind: 'FIXED', value: 1_000n } },
      { alsoChanges: value, label: 'ZERO to FIXED, a value appears' },
    ),
    edit(`${O}rule.value`, 'overrides', 0, { rule: { kind: 'PCT', value: 1_501n } }),
    edit(`${C}source_period`, 'corrections', 0, { sourcePeriod: '2026-08' }),
    edit(`${C}source_ref`, 'corrections', 0, { sourceRef: 'line:old-1b' }),
    edit(`${C}kind`, 'corrections', 0, { kind: 'SALE' }),
    edit(`${C}amount`, 'corrections', 0, { amount: 3_001n }),
    edit(`${C}previous_amount`, 'corrections', 0, { previousAmount: 1n }),
    edit(`${C}new_amount`, 'corrections', 0, { newAmount: 3_001n }),
    edit(`${C}generation`, 'corrections', 0, { generation: 2n }),
    edit(`${B}source_period`, 'blocked', 0, { sourcePeriod: '2026-09' }),
    edit(`${B}code`, 'blocked', 0, { code: 'NO_SALARY' }),
    edit(`${R}source_statement_id`, 'carries', 2, { sourceStatementId: 'statement-aug2' }),
    edit(`${R}kind`, 'carries', 2, { kind: 'TIP_CARD' }),
    edit(`${R}amount`, 'carries', 2, { amount: -1_001n }),
  ];
}
