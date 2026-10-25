import { raw, type HtmlFragment } from '../html/fragment.ts';
import { baseLayout, bdi } from '../html/layout.ts';
import { html } from '../html/template.ts';

import { LANDSCAPE_PAGE_CSS, STATEMENT_CSS } from './attendance-statement-css.ts';
import {
  RANGE,
  statementFooter,
  statementHeader,
  statementSignatures,
  totalsCells,
  totalsHeaderCells,
  type BranchStatementDocument,
} from './attendance-statement-parts.ts';

/**
 * بيان الفرع: جدول عرضي لكل موظفة ليها تغطية، وتوقيع لكل صف، وتوقيع المدير تحت الجدول.
 *
 * @param statement البيان بعد ما اتحقّق من العقد
 * @returns مستند HTML كامل
 */
export function branchStatementHtml(statement: BranchStatementDocument): string {
  const labels = statement.labels;
  const body = html`<style>
      ${raw(`${STATEMENT_CSS}\n${LANDSCAPE_PAGE_CSS}`)}
    </style>
    ${statementHeader({
      labels,
      title: labels.branchTitle,
      businessName: statement.header.business_name,
      branchName: statement.header.branch_name,
      logo: statement.header.logo,
      period: statement.header.period,
      details: branchDetails(statement),
    })}
    ${branchTable(statement)} ${statementSignatures([labels.managerSignature])}`;
  return baseLayout({
    language: statement.language,
    title: labels.branchTitle,
    body,
    footer: statementFooter(labels, statement.issued_at),
  }).value;
}

/**
 * الفلاتر المطبّقة على البيان: الموظفة وزوج الوردية (BR-03 و BR-11).
 *
 * @param statement البيان بعد ما اتحقّق من العقد
 * @returns سطور التفاصيل بتاعة الرأس
 */
function branchDetails(statement: BranchStatementDocument): HtmlFragment[] {
  const labels = statement.labels;
  const details: HtmlFragment[] = [];
  const employee = statement.header.employee_filter;
  if (employee !== null) {
    details.push(
      html`${labels.employeeFilterLabel}: ${bdi(employee.name)} (${labels.employeeNumberLabel}:
      ${bdi(String(employee.employee_number))})`,
    );
  }
  const shift = statement.header.shift_filter;
  if (shift !== null) {
    details.push(html`${labels.shiftFilterLabel}: ${bdi(shift.start)}${RANGE}${bdi(shift.end)}`);
  }
  return details;
}

/**
 * جدول الفرع: صف لكل موظفة، وعمود توقيع فاضي لكل صف (BR-04).
 *
 * @param statement البيان بعد ما اتحقّق من العقد
 * @returns الجدول المطبوع
 */
function branchTable(statement: BranchStatementDocument): HtmlFragment {
  const labels = statement.labels;
  return html`<table class="statement-table statement-branch">
    <thead>
      <tr>
        <th>${labels.employeeNumber}</th>
        <th>${labels.employeeName}</th>
        ${totalsHeaderCells(labels)}
        <th>${labels.signature}</th>
      </tr>
    </thead>
    <tbody>
      ${statement.rows.map(
        (row) =>
          html`<tr>
            <td class="statement-number">${bdi(String(row.employee_number))}</td>
            <td>${bdi(row.name)}</td>
            ${totalsCells(row.totals)}
            <td class="statement-signature-cell"></td>
          </tr>`,
      )}
    </tbody>
  </table>`;
}
