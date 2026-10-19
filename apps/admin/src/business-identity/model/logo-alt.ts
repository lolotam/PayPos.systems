import type { Locale } from '@pospay/i18n';
import type { OfficialNames } from './changed-official-names';

function filled(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? undefined : trimmed;
}

/** اسم اللغة الحالية، ثم الاسم الرسمي الآخر، وإلا لا شيء والنص البديل يبقى في الكتالوج. */
export function logoAltText(locale: Locale, names: OfficialNames | null): string | undefined {
  const primary = locale === 'ar' ? names?.official_name_ar : names?.official_name_en;
  const secondary = locale === 'ar' ? names?.official_name_en : names?.official_name_ar;
  return filled(primary) ?? filled(secondary);
}
