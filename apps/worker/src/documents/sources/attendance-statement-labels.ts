import {
  attendanceStatementLabelKeys,
  type AttendanceStatementLabelKey,
  type AttendanceStatementLabels,
} from '@pospay/contracts';
import { t, type Locale, type MessageKey } from '@pospay/i18n';

/**
 * مفتاح عنوان واحد في كتالوج i18n؛ المفتاح بيتجمّع من القسم واسم العنوان.
 *
 * @param name اسم العنوان كما هو في العقد
 * @returns المفتاح الكامل في الكتالوج
 */
function labelKey(name: AttendanceStatementLabelKey): MessageKey {
  return `attendanceStatement.${name}` as MessageKey;
}

/**
 * عناوين البيان المطبوعة بلغة الطلب. القالب في packages/documents مالوش اعتماد على i18n
 * (FR-015)، فالمصدر بيبعت العناوين جاهزة؛ ومفاتيح العقد هي مرجع القسم ده.
 *
 * @param language لغة الطلب
 * @returns عناوين البيان جاهزة للطباعة
 */
export function statementLabels(language: Locale): AttendanceStatementLabels {
  const labels: Partial<Record<AttendanceStatementLabelKey, string>> = {};
  for (const name of attendanceStatementLabelKeys) {
    labels[name] = t(language, labelKey(name));
  }
  return labels as AttendanceStatementLabels;
}
