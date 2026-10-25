import config, { allowUserFacingText } from '@pospay/config/eslint';

export default [
  ...config,
  // Reference rows carry their own bilingual name columns (name_ar, CLAUDE.md §5) — that is data, not interface text.
  { files: ['src/seed.ts'], ...allowUserFacingText() },
  // CLAUDE.md §3 بيستثني ملفات الـ schema من حد max-lines بس؛ النمط في الإعدادات المشتركة نسبي لمجلد الـ repo
  // فمش بيوصلش لما الـ lint يشتغل من هنا، فبنطبّق الاستثناء على schema/**. وcallbacks الجداول (القيود
  // والفهارس) قوائم تعريفية زي max-lines نفسها، فحد الدوال مش معني هنا.
  { files: ['schema/**'], rules: { 'max-lines': 'off', 'max-lines-per-function': 'off' } },
];
