import type { AttendanceStatementDocument, AttendanceStatementLabels } from '@pospay/contracts';

import type { HtmlFragment } from '../html/fragment.ts';
import { imageDataUri } from '../html/image.ts';
import { bdi } from '../html/layout.ts';
import { html } from '../html/template.ts';

/** خانة فاضية: المتعاقد والفرق مش مرتبطين بشيفت، فبتطبع شرطة (BR-11). */
export const EMPTY_CELL = '—';

/** فاصل المدى بين تاريخين أو بين بداية ونهاية؛ الشرطة الفاضية غيرها عشان تتفرق في القراءة. */
export const RANGE = ' – ';

export type BranchStatementDocument = Extract<AttendanceStatementDocument, { form: 'BRANCH' }>;
export type EmployeeStatementDocument = Extract<AttendanceStatementDocument, { form: 'EMPLOYEE' }>;
export type StatementTotals = BranchStatementDocument['rows'][number]['totals'];
export type StatementLeave = StatementTotals['leave'][number];
export type StatementDay = EmployeeStatementDocument['days'][number];
export type StatementSession = StatementDay['sessions'][number];
export type StatementLogo = BranchStatementDocument['header']['logo'];

const LEAVE_LABEL_KEYS = {
  ANNUAL: 'leaveAnnual',
  SICK: 'leaveSick',
  UNPAID: 'leaveUnpaid',
  OTHER: 'leaveOther',
} as const;

/**
 * الشعار كـ data URI. الـ base64 بيتفك لبايتات الأول، فأي نص hostile في الوصول للماركب
 * بيوصل بايتات مش وسم (FR-015).
 *
 * @param logo الشعار من العقد، أو null لما مفيش شعار
 * @returns قطعة data URI جاهزة للـ src، أو null
 */
export function statementLogo(logo: StatementLogo): HtmlFragment | null {
  if (logo === null) return null;
  return imageDataUri(Buffer.from(logo.base64, 'base64'), logo.content_type);
}

/**
 * رأس البيان: الشعار أو الاسم بس، واسم النشاط، واسم الفرع، والفترة، وسطور التفاصيل.
 *
 * @param input العناوين وأسماء النشاط والفرع والفترة والشعار وسطور التفاصيل
 * @returns رأس المطبوع
 */
export function statementHeader(input: {
  readonly labels: AttendanceStatementLabels;
  readonly title: string;
  readonly businessName: string;
  readonly branchName: string;
  readonly logo: StatementLogo;
  readonly period: { readonly from: string; readonly to: string };
  readonly details: readonly HtmlFragment[];
}): HtmlFragment {
  const logo = statementLogo(input.logo);
  return html`<header class="statement-header">
    ${logo === null ? '' : html`<img class="statement-logo" src="${logo}" alt="${input.businessName}" />`}
    <div class="statement-headings">
      <p class="statement-business">${bdi(input.businessName)}</p>
      <h1 class="statement-title">${input.title}</h1>
      <p class="statement-line">${input.labels.branchLabel}: ${bdi(input.branchName)}</p>
      <p class="statement-line">
        ${input.labels.periodLabel}: ${bdi(input.period.from)}${RANGE}${bdi(input.period.to)}
      </p>
      ${input.details.map((detail) => html`<p class="statement-line">${detail}</p>`)}
    </div>
  </header>`;
}

/**
 * تذييل البيان: نص المالك وتاريخ الإصدار (BR-06).
 *
 * @param labels عناوين البيان
 * @param issuedAt تاريخ ووقت الإصدار نص جاهز للطباعة
 * @returns التذييل المطبوع
 */
export function statementFooter(labels: AttendanceStatementLabels, issuedAt: string): HtmlFragment {
  return html`<p class="statement-footer">${labels.footer}</p>
    <p class="statement-issued">${labels.issuedAt}: ${bdi(issuedAt)}</p>`;
}

/**
 * سطور التوقيع: الموظفة والمدير في بيان الموظفة، والمدير في بيان الفرع (BR-04).
 *
 * @param names عناوين سطور التوقيع بالترتيب
 * @returns كتلة التوقيعات
 */
export function statementSignatures(names: readonly string[]): HtmlFragment {
  return html`<div class="statement-signatures">
    ${names.map(
      (name) =>
        html`<div class="statement-signature">
          <p class="statement-signature-label">${name}</p>
          <div class="statement-signature-rule"></div>
        </div>`,
    )}
  </div>`;
}

/**
 * عناوين أعمدة الأرقام؛ نفس الأعمدة في جدول الفرع وفي كتلة الإجماليات (spec 061 §6.6).
 *
 * @param labels عناوين البيان
 * @returns خلايا العناوين
 */
export function totalsHeaderCells(labels: AttendanceStatementLabels): HtmlFragment {
  return html`<th>${labels.daysPresent}</th>
    <th>${labels.workedHours}</th>
    <th>${labels.scheduledHours}</th>
    <th>${labels.contractedHours}</th>
    <th>${labels.difference}</th>
    <th>${labels.leaveAnnual}</th>
    <th>${labels.leaveSick}</th>
    <th>${labels.leaveUnpaid}</th>
    <th>${labels.leaveOther}</th>
    <th>${labels.lateCount}</th>
    <th>${labels.lateMinutes}</th>
    <th>${labels.missingClockOut}</th>
    <th>${labels.manualDays}</th>`;
}

/**
 * خلايا أرقام الموظفة؛ المتعاقد والفرق الفاضيين يطبعوا شرطة (BR-11).
 *
 * @param totals أرقام الموظفة في الفترة
 * @returns خلايا القيم
 */
export function totalsCells(totals: StatementTotals): HtmlFragment {
  return html`<td class="statement-number">${totals.days_present}</td>
    <td class="statement-number">${bdi(totals.worked_hours)}</td>
    <td class="statement-number">${bdi(totals.scheduled_hours)}</td>
    <td class="statement-number">${bdi(totals.contracted_hours ?? EMPTY_CELL)}</td>
    <td class="statement-number">${bdi(totals.difference_hours ?? EMPTY_CELL)}</td>
    ${leaveCell(totals.leave, 'ANNUAL')} ${leaveCell(totals.leave, 'SICK')}
    ${leaveCell(totals.leave, 'UNPAID')} ${leaveCell(totals.leave, 'OTHER')}
    <td class="statement-number">${totals.late_count}</td>
    <td class="statement-number">${totals.late_minutes}</td>
    <td class="statement-number">${totals.missing_clock_out}</td>
    <td class="statement-number">${totals.manual_days}</td>`;
}

/**
 * خلية نوع إجازة: الأيام، والساعات الجزئية في قوسين بس لما تكون موجودة.
 *
 * @param leave الإجازات مجمّعة بالنوع
 * @param type نوع الإجازة المطلوب
 * @returns خلية القيمة
 */
function leaveCell(leave: readonly StatementLeave[], type: StatementLeave['type']): HtmlFragment {
  const entry = leave.find((item) => item.type === type);
  if (entry === undefined) return html`<td class="statement-number">0</td>`;
  const partial = entry.partial_hours;
  return html`<td class="statement-number">
    ${entry.days}${partial === '0:00' ? '' : html` (${bdi(partial)})`}
  </td>`;
}

/**
 * اسم نوع الإجازة بالعنوان المطبوع.
 *
 * @param labels عناوين البيان
 * @param type نوع الإجازة
 * @returns اسم النوع
 */
export function leaveLabel(
  labels: AttendanceStatementLabels,
  type: StatementLeave['type'],
): string {
  return labels[LEAVE_LABEL_KEYS[type]];
}
