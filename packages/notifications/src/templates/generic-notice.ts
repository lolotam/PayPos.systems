import { validateParameters, type SafeParameter, type TemplateDefinition } from './definition.ts';

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

export function validInAppTemplate(
  key: string,
  revision: number,
  locale: string,
  parameters: readonly SafeParameter[],
): boolean {
  return (
    key === genericNotice.key &&
    revision === genericNotice.revision &&
    validateParameters(genericNotice, locale, parameters)
  );
}
