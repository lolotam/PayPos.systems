import { validateParameters, type SafeParameter, type TemplateDefinition } from './definition.ts';
import { breakNotReturned } from './break-not-returned.ts';
import { lateServiceSession } from './late-service-session.ts';
import { serviceLineCancelled } from './service-line-cancelled.ts';
import { serviceLinePriceEdited } from './service-line-price-edited.ts';
import { shiftNotClockedIn } from './shift-not-clocked-in.ts';
import { attendanceChangeRequested } from './attendance-change-requested.ts';
import { attendanceChangeDecided } from './attendance-change-decided.ts';

export const genericNotice: TemplateDefinition = {
  key: 'generic_notice',
  revision: 1,
  locales: ['ar', 'en'],
  category: 'UTILITY',
  parameters: [
    { name: 'subject', type: 'text', required: true, sensitivity: 'safe', component: 'body' },
  ],
  copy: { ar: 'تحديث بخصوص {{subject}}', en: 'Update for {{subject}}' },
};

const breakReturnedOtherBranch: TemplateDefinition = {
  ...breakNotReturned,
  key: 'break_returned_other_branch',
  parameters: breakNotReturned.parameters.filter((parameter) => parameter.name !== 'break_end'),
  copy: {
    ar: '{{employee_name_ar}} رجعت من البريك في فرع {{branch_name_ar}}',
    en: '{{employee_name_en}} returned from the break at {{branch_name_en}}',
  },
};

export function validInAppTemplate(
  key: string,
  revision: number,
  locale: string,
  parameters: readonly SafeParameter[],
): boolean {
  const definition =
    [
      genericNotice,
      lateServiceSession,
      serviceLinePriceEdited,
      serviceLineCancelled,
      shiftNotClockedIn,
      breakNotReturned,
      breakReturnedOtherBranch,
      attendanceChangeRequested,
      attendanceChangeDecided,
    ].find((item) => item.key === key) ?? null;
  return (
    definition !== null &&
    revision === definition.revision &&
    validateParameters(definition, locale, parameters)
  );
}
