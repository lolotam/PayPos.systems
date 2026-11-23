import type { CommissionStatementSource } from '../ports/commission-statement.port.ts';

export const BUSINESS = '01920000-0000-7000-8000-0000000000a1';
export const SALMIYA = '01920000-0000-7000-8000-0000000000b1';
export const RANA = '01920000-0000-7000-8000-0000000000e1';
export const PERIOD = '2026-10';

/**
 * مصادر كشف صغيرة: موظفة واحدة من غير أي بند، فالباني بيطلّع صف EMPLOYEE لوحده وبصمتين ثابتتين. كفاية
 * لإثبات اختيار الشكل والخطوات من غير ما نعيد اختبار الباني نفسه (اتغطى في محرك العمولات).
 */
export function statementSource(
  statement: CommissionStatementSource['statement'] = null,
): CommissionStatementSource {
  return {
    statement,
    employees: [{ employeeId: RANA, employeeNumber: 1, nameAr: null, nameEn: 'Rana' }],
    attachments: [{ employeeId: RANA, branchId: SALMIYA, from: '2026-01-01', to: null }],
    month: {
      lines: [],
      sales: [],
      tips: [],
      salaries: [],
      versions: [],
      overrides: [],
      corrections: [],
      carries: [],
    },
    blocked: [],
    names: { branches: new Map(), services: new Map(), customers: new Map() },
    correctionLineDetails: new Map(),
  };
}

/** صف كشف بحالة وبصمات مخزّنة، من غير أي حقل غير اللي الاختبار بيحتاجه. */
export function statementRecord(
  overrides: Partial<NonNullable<CommissionStatementSource['statement']>> = {},
): NonNullable<CommissionStatementSource['statement']> {
  return {
    status: 'DRAFT',
    currentFingerprint: null,
    reviewedFingerprint: null,
    reviewedStatementFingerprint: null,
    ...overrides,
  };
}
