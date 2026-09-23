/** اللغة اللي النشاط بيطبع بيها الفواتير والرسائل لو العميل ما اختارش. */
export type SettingsLanguage = 'ar' | 'en';
/** التقويم اللي التواريخ بتتعرض بيه. */
export type SettingsCalendar = 'gregorian' | 'hijri';

/** الإعدادات اللي النشاط يقدر يغيّرها — null معناه "زي الـ template". */
export interface SettingsOverrides {
  readonly defaultLanguage: SettingsLanguage | null;
  readonly calendar: SettingsCalendar | null;
}

/** قيم الـ template — اللي بيتاخد لما النشاط ما يغيّرش. */
export interface SettingsTemplateValues {
  readonly defaultLanguage: SettingsLanguage;
  readonly calendar: SettingsCalendar;
}

/** الإعدادات الفعلية بعد ما الـ template والتعديلات يتدمجوا. */
export interface EffectiveSettings {
  readonly defaultLanguage: SettingsLanguage;
  readonly calendar: SettingsCalendar;
  /** المفاتيح اللي النشاط غيّرها بنفسه، بنفس ترتيب الـ contract. */
  readonly overridden: readonly ('default_language' | 'calendar')[];
}

// الـ template لكل الأنشطة لحد ما يبقى فيه اختلاف بين الـ verticals. العربي الأول (CLAUDE.md §0).
// TODO(spec): التقويم الافتراضي — ميلادي لحد ما العميل يقول غير كده.
export const SETTINGS_TEMPLATE: SettingsTemplateValues = {
  defaultLanguage: 'ar',
  calendar: 'gregorian',
};

/**
 * بيدمج الـ template مع تعديلات النشاط (قرار Waleed 2026-09-23: الـ template الأول، وبعدين العميل): أي قيمة النشاط
 * حطها بتغطي الـ template، وأي null بترجع للـ template — فتغيير الـ template بيوصل لكل نشاط ما غيّرش القيمة دي.
 *
 * @param template  قيم الـ template
 * @param overrides اللي النشاط غيّره، أو null لو لسه ما غيّرش حاجة
 * @returns القيم الفعلية واللي منها متغيّر
 */
export function effectiveSettings(
  template: SettingsTemplateValues,
  overrides: SettingsOverrides | null,
): EffectiveSettings {
  const language = overrides?.defaultLanguage ?? null;
  const calendar = overrides?.calendar ?? null;
  return {
    defaultLanguage: language ?? template.defaultLanguage,
    calendar: calendar ?? template.calendar,
    overridden: [
      ...(language === null ? [] : (['default_language'] as const)),
      ...(calendar === null ? [] : (['calendar'] as const)),
    ],
  };
}
