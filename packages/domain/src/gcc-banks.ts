import type { GccIbanCountry } from './iban.js';

/** بنك مرجعي؛ الرمز غير المتحقق منه يبقى فارغاً ولا يستخدم لاختيار البنك تلقائياً. */
export interface GccBank {
  readonly id: string;
  readonly country: GccIbanCountry;
  readonly ibanBankCode: string | null;
  readonly nameEn: string;
  readonly nameAr: string;
}

/** قائمة المالك المعتمدة؛ لا تضاف رموز بنكية غير متحقق منها. */
/* eslint-disable no-restricted-syntax -- Spec 040 explicitly places the owner's bilingual reference list in this zero-dependency package. */
// prettier-ignore
export const GCC_BANKS: readonly GccBank[] = [
  { id: 'kw-nbk', country: 'KW', ibanBankCode: 'NBOK', nameEn: 'National Bank of Kuwait', nameAr: 'بنك الكويت الوطني' },
  { id: 'kw-cbk', country: 'KW', ibanBankCode: 'CBKU', nameEn: 'Commercial Bank of Kuwait', nameAr: 'البنك التجاري الكويتي' },
  { id: 'kw-gulf', country: 'KW', ibanBankCode: 'GULB', nameEn: 'Gulf Bank', nameAr: 'بنك الخليج' },
  { id: 'kw-abk', country: 'KW', ibanBankCode: 'ABKK', nameEn: 'Al Ahli Bank of Kuwait', nameAr: 'البنك الأهلي الكويتي' },
  { id: 'kw-burgan', country: 'KW', ibanBankCode: 'BRGN', nameEn: 'Burgan Bank', nameAr: 'بنك برقان' },
  { id: 'kw-kfh', country: 'KW', ibanBankCode: 'KFHO', nameEn: 'Kuwait Finance House', nameAr: 'بيت التمويل الكويتي' },
  { id: 'kw-boubyan', country: 'KW', ibanBankCode: 'BBYN', nameEn: 'Boubyan Bank', nameAr: 'بنك بوبيان' },
  { id: 'kw-kib', country: 'KW', ibanBankCode: null, nameEn: 'Kuwait International Bank', nameAr: 'بنك الكويت الدولي' },
  { id: 'kw-warba', country: 'KW', ibanBankCode: null, nameEn: 'Warba Bank', nameAr: 'بنك وربة' },
  { id: 'kw-ibk', country: 'KW', ibanBankCode: null, nameEn: 'Industrial Bank of Kuwait', nameAr: 'بنك الكويت الصناعي' },
  { id: 'kw-other', country: 'KW', ibanBankCode: null, nameEn: 'Other bank', nameAr: 'بنك آخر' },
  { id: 'bh-nbb', country: 'BH', ibanBankCode: 'NBOB', nameEn: 'National Bank of Bahrain', nameAr: 'بنك البحرين الوطني' },
  { id: 'bh-bbk', country: 'BH', ibanBankCode: 'BBKU', nameEn: 'Bank of Bahrain and Kuwait', nameAr: 'بنك البحرين والكويت' },
  { id: 'bh-aub', country: 'BH', ibanBankCode: 'AUBB', nameEn: 'Ahli United Bank', nameAr: 'البنك الأهلي المتحد' },
  { id: 'bh-bisb', country: 'BH', ibanBankCode: 'BIBB', nameEn: 'Bahrain Islamic Bank', nameAr: 'بنك البحرين الإسلامي' },
  { id: 'bh-kfh', country: 'BH', ibanBankCode: 'KFHB', nameEn: 'Kuwait Finance House Bahrain', nameAr: 'بيت التمويل الكويتي - البحرين' },
  { id: 'bh-other', country: 'BH', ibanBankCode: null, nameEn: 'Other bank', nameAr: 'بنك آخر' },
  { id: 'qa-qnb', country: 'QA', ibanBankCode: 'QNBA', nameEn: 'Qatar National Bank', nameAr: 'بنك قطر الوطني' },
  { id: 'qa-cbq', country: 'QA', ibanBankCode: 'CBQA', nameEn: 'Commercial Bank of Qatar', nameAr: 'البنك التجاري القطري' },
  { id: 'qa-doha', country: 'QA', ibanBankCode: 'DOHB', nameEn: 'Doha Bank', nameAr: 'بنك الدوحة' },
  { id: 'qa-qib', country: 'QA', ibanBankCode: 'QISB', nameEn: 'Qatar Islamic Bank', nameAr: 'مصرف قطر الإسلامي' },
  { id: 'qa-qiib', country: 'QA', ibanBankCode: 'QIIB', nameEn: 'Qatar International Islamic Bank', nameAr: 'بنك قطر الدولي الإسلامي' },
  { id: 'qa-rayan', country: 'QA', ibanBankCode: null, nameEn: 'Masraf Al Rayan', nameAr: 'مصرف الريان' },
  { id: 'qa-other', country: 'QA', ibanBankCode: null, nameEn: 'Other bank', nameAr: 'بنك آخر' },
  { id: 'sa-snb', country: 'SA', ibanBankCode: null, nameEn: 'Saudi National Bank', nameAr: 'البنك الأهلي السعودي' },
  { id: 'sa-rajhi', country: 'SA', ibanBankCode: null, nameEn: 'Al Rajhi Bank', nameAr: 'مصرف الراجحي' },
  { id: 'sa-riyad', country: 'SA', ibanBankCode: null, nameEn: 'Riyad Bank', nameAr: 'بنك الرياض' },
  { id: 'sa-sab', country: 'SA', ibanBankCode: null, nameEn: 'Saudi Awwal Bank', nameAr: 'البنك السعودي الأول' },
  { id: 'sa-bsf', country: 'SA', ibanBankCode: null, nameEn: 'Banque Saudi Fransi', nameAr: 'البنك السعودي الفرنسي' },
  { id: 'sa-anb', country: 'SA', ibanBankCode: null, nameEn: 'Arab National Bank', nameAr: 'البنك العربي الوطني' },
  { id: 'sa-alinma', country: 'SA', ibanBankCode: null, nameEn: 'Alinma Bank', nameAr: 'مصرف الإنماء' },
  { id: 'sa-albilad', country: 'SA', ibanBankCode: null, nameEn: 'Bank AlBilad', nameAr: 'بنك البلاد' },
  { id: 'sa-aljazira', country: 'SA', ibanBankCode: null, nameEn: 'Bank AlJazira', nameAr: 'بنك الجزيرة' },
  { id: 'sa-other', country: 'SA', ibanBankCode: null, nameEn: 'Other bank', nameAr: 'بنك آخر' },
  { id: 'ae-enbd', country: 'AE', ibanBankCode: null, nameEn: 'Emirates NBD', nameAr: 'بنك الإمارات دبي الوطني' },
  { id: 'ae-fab', country: 'AE', ibanBankCode: null, nameEn: 'First Abu Dhabi Bank', nameAr: 'بنك أبوظبي الأول' },
  { id: 'ae-adcb', country: 'AE', ibanBankCode: null, nameEn: 'Abu Dhabi Commercial Bank', nameAr: 'بنك أبوظبي التجاري' },
  { id: 'ae-dib', country: 'AE', ibanBankCode: null, nameEn: 'Dubai Islamic Bank', nameAr: 'بنك دبي الإسلامي' },
  { id: 'ae-mashreq', country: 'AE', ibanBankCode: null, nameEn: 'Mashreq Bank', nameAr: 'بنك المشرق' },
  { id: 'ae-adib', country: 'AE', ibanBankCode: null, nameEn: 'Abu Dhabi Islamic Bank', nameAr: 'مصرف أبوظبي الإسلامي' },
  { id: 'ae-other', country: 'AE', ibanBankCode: null, nameEn: 'Other bank', nameAr: 'بنك آخر' },
  { id: 'om-muscat', country: 'OM', ibanBankCode: null, nameEn: 'Bank Muscat', nameAr: 'بنك مسقط' },
  { id: 'om-nbo', country: 'OM', ibanBankCode: null, nameEn: 'National Bank of Oman', nameAr: 'البنك الوطني العماني' },
  { id: 'om-dhofar', country: 'OM', ibanBankCode: null, nameEn: 'Bank Dhofar', nameAr: 'بنك ظفار' },
  { id: 'om-sohar', country: 'OM', ibanBankCode: null, nameEn: 'Sohar International', nameAr: 'صحار الدولي' },
  { id: 'om-other', country: 'OM', ibanBankCode: null, nameEn: 'Other bank', nameAr: 'بنك آخر' },
];
/* eslint-enable no-restricted-syntax */

/**
 * يبحث بالمعرّف الثابت كي لا تتحول الأسماء المترجمة إلى مفاتيح تخزين.
 *
 * @param id معرّف البنك
 * @returns البنك إن كان في القائمة
 */
export function findGccBank(id: string): GccBank | undefined {
  return GCC_BANKS.find((b) => b.id === id);
}

/**
 * يحصر خيارات النموذج في دولة الحساب؛ الحسابات من دولة أخرى لا تقبل البنك.
 *
 * @param country دولة الحساب
 * @returns البنوك المعتمدة لتلك الدولة
 */
export function banksForCountry(country: GccIbanCountry): readonly GccBank[] {
  return GCC_BANKS.filter((b) => b.country === country);
}

/**
 * يختار البنك فقط عندما يكون رمز الآيبان معروفاً، وإلا يترك الاختيار للمستخدم.
 *
 * @param country دولة الحساب
 * @param code رمز البنك داخل الآيبان
 * @returns البنك المطابق إن وجد
 */
export function bankForIbanCode(country: GccIbanCountry, code: string): GccBank | undefined {
  return GCC_BANKS.find((b) => b.country === country && b.ibanBankCode === code);
}
