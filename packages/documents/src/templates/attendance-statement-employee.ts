import type { AttendanceStatementLabels } from '@pospay/contracts';

import { raw, type HtmlFragment } from '../html/fragment.ts';
import { baseLayout, bdi } from '../html/layout.ts';
import { html } from '../html/template.ts';

import { STATEMENT_CSS } from './attendance-statement-css.ts';
import {
  EMPTY_CELL,
  RANGE,
  leaveLabel,
  statementFooter,
  statementHeader,
  statementSignatures,
  totalsCells,
  totalsHeaderCells,
  type EmployeeStatementDocument,
  type StatementDay,
  type StatementSession,
} from './attendance-statement-parts.ts';

/**
 * بيان الموظفة: يوم بيوم في الفترة، وبعدين أرقامها، وبعدين توقيعين (BR-04).
 *
 * @param statement البيان بعد ما اتحقّق من العقد
 * @returns مستند HTML كامل
 */
export function employeeStatementHtml(statement: EmployeeStatementDocument): string {
  const labels = statement.labels;
  const body = html`<style>
      ${raw(STATEMENT_CSS)}
    </style>
    ${statementHeader({
      labels,
      title: labels.employeeTitle,
      businessName: statement.header.business_name,
      branchName: statement.header.branch_name,
      logo: statement.header.logo,
      period: statement.header.period,
      details: employeeDetails(statement),
    })}
    ${employeeDaysTable(statement)} ${employeeTotals(statement)}
    ${statementSignatures([labels.employeeSignature, labels.managerSignature])}`;
  return baseLayout({
    language: statement.language,
    title: labels.employeeTitle,
    body,
    footer: statementFooter(labels, statement.issued_at),
  }).value;
}

/**
 * سطر الموظفة في الرأس: اسمها ورقمها.
 *
 * @param statement البيان بعد ما اتحقّق من العقد
 * @returns سطر التفاصيل
 */
function employeeDetails(statement: EmployeeStatementDocument): HtmlFragment[] {
  const labels = statement.labels;
  const employee = statement.header.employee;
  return [
    html`${labels.employeeLabel}: ${bdi(employee.name)} (${labels.employeeNumberLabel}:
    ${bdi(String(employee.employee_number))})`,
  ];
}

/**
 * جدول الأيام: سطر لكل يوم في الفترة، والجلسات كل واحدة في سطر (Story 2.2).
 *
 * @param statement البيان بعد ما اتحقّق من العقد
 * @returns الجدول المطبوع
 */
function employeeDaysTable(statement: EmployeeStatementDocument): HtmlFragment {
  const labels = statement.labels;
  return html`<table class="statement-table statement-days">
    <thead>
      <tr>
        <th>${labels.date}</th>
        <th>${labels.sessions}</th>
        <th>${labels.workedHours}</th>
        <th>${labels.notes}</th>
      </tr>
    </thead>
    <tbody>
      ${statement.days.map(
        (day) =>
          html`<tr>
            <td class="statement-number">${bdi(day.date)}</td>
            <td>${day.sessions.map((session) => sessionCell(labels, session))}</td>
            <td class="statement-number">${bdi(day.worked_hours)}</td>
            <td>${dayNotes(labels, day)}</td>
          </tr>`,
      )}
    </tbody>
  </table>`;
}

/**
 * جلسة واحدة: الدخول والخروج، وعلامة البصمة الناقصة، واليدوي، والتأخير.
 *
 * @param labels عناوين البيان
 * @param session الجلسة من العقد
 * @returns خلية الجلسة
 */
function sessionCell(labels: AttendanceStatementLabels, session: StatementSession): HtmlFragment {
  const time =
    session.clock_out === null
      ? html`${bdi(session.clock_in)} ${EMPTY_CELL}`
      : html`${bdi(session.clock_in)}${RANGE}${bdi(session.clock_out)}`;
  return html`<div class="statement-session">
    <span class="statement-session-time">${time}</span>
    ${session.missing_clock_out ? html`<span class="statement-session-flag">${labels.missingClockOut}</span>` : ''}
    ${session.manual ? html`<span class="statement-session-flag">${labels.manual}</span>` : ''}
    ${session.late_minutes > 0 ? html`<span class="statement-session-flag">${labels.lateMinutes}: ${session.late_minutes}</span>` : ''}
  </div>`;
}

/**
 * ملاحظات اليوم: لسه جوّه، والإجازات، والورديات، وغياب الحضور المسجّل.
 * «لسه جوّه» له الأولوية، ويوم ما بيطبعش «لا يوجد حضور مسجّل» (FR-013a).
 *
 * @param labels عناوين البيان
 * @param day يوم من العقد
 * @returns خلية الملاحظات
 */
function dayNotes(labels: AttendanceStatementLabels, day: StatementDay): HtmlFragment {
  const notes: HtmlFragment[] = [];
  if (day.still_in) notes.push(html`<span class="statement-note">${labels.stillIn}</span>`);
  for (const type of day.leave) {
    notes.push(html`<span class="statement-note">${leaveLabel(labels, type)}</span>`);
  }
  if (day.scheduled.length > 0 && day.sessions.length === 0) {
    for (const shift of day.scheduled) {
      notes.push(
        html`<span class="statement-note">${bdi(shift.start)}${RANGE}${bdi(shift.end)}</span>`,
      );
    }
  }
  if (day.no_attendance && !day.still_in) {
    notes.push(html`<span class="statement-note">${labels.noAttendance}</span>`);
  }
  return html`<span class="statement-notes">${notes}</span>`;
}

/**
 * كتلة الإجماليات: نفس أعمدة جدول الفرع للموظفة دي (spec 061 §6.6).
 *
 * @param statement البيان بعد ما اتحقّق من العقد
 * @returns الكتلة المطبوعة
 */
function employeeTotals(statement: EmployeeStatementDocument): HtmlFragment {
  const labels = statement.labels;
  return html`<h2 class="statement-subtitle">${labels.totalsTitle}</h2>
    <table class="statement-table statement-totals">
      <thead>
        <tr>
          ${totalsHeaderCells(labels)}
        </tr>
      </thead>
      <tbody>
        <tr>
          ${totalsCells(statement.totals)}
        </tr>
      </tbody>
    </table>`;
}
