import type { Country, VerticalType } from '@pospay/contracts';
import type { Locale, MessageKey } from '@pospay/i18n';
import { t } from '@pospay/i18n';

// ترتيب القيم حرفيًا هو القرار: السالون أول ومختار مبدئيًا في شاشة أول نشاط، والكويت
// الافتراضية في قائمة الدولة؛ والنوع من العقد بيمنع أي قيمة بره enum الاتنين.
const VERTICAL_TYPES: readonly VerticalType[] = [
  'salon',
  'restaurant',
  'laundry',
  'retail',
  'services',
];

const COUNTRIES: readonly Country[] = ['KW', 'SA', 'AE', 'BH', 'QA', 'OM'];

const VERTICAL_KEYS: Record<VerticalType, MessageKey> = {
  salon: 'admin.verticalSalon',
  restaurant: 'admin.verticalRestaurant',
  laundry: 'admin.verticalLaundry',
  retail: 'admin.verticalRetail',
  services: 'admin.verticalServices',
};

const COUNTRY_KEYS: Record<Country, MessageKey> = {
  KW: 'admin.countryKW',
  SA: 'admin.countrySA',
  AE: 'admin.countryAE',
  BH: 'admin.countryBH',
  QA: 'admin.countryQA',
  OM: 'admin.countryOM',
};

/** خيارات نوع النشاط بترتيب الشاشة (السالون أول) وبنصوص الكتالوج. */
export function verticalOptions(locale: Locale) {
  return VERTICAL_TYPES.map((value) => ({ value, label: t(locale, VERTICAL_KEYS[value]) }));
}

/** خيارات الدولة الست المقبولة في العقد بنصوص الكتالوج. */
export function countryOptions(locale: Locale) {
  return COUNTRIES.map((value) => ({ value, label: t(locale, COUNTRY_KEYS[value]) }));
}
