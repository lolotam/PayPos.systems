import type { AttendanceStatementDocument } from '@pospay/contracts';

import { branchStatementHtml } from './attendance-statement-branch.ts';
import { employeeStatementHtml } from './attendance-statement-employee.ts';

/**
 * بيان الحضور المطبوع: نموذج الفرع ولا نموذج الموظفة. القالب بياخد نص جاهز للطباعة
 * (أسماء، تواريخ، ساعات، وعناوين بلغة الطلب) عشان مايبقاش له اعتماد على i18n (FR-015).
 *
 * @param document البيان بعد ما اتحقّق من العقد
 * @returns مستند HTML كامل جاهز للطباعة
 */
export function attendanceStatementHtml(document: AttendanceStatementDocument): string {
  return document.form === 'BRANCH'
    ? branchStatementHtml(document)
    : employeeStatementHtml(document);
}
