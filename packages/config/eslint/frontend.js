import reactHooks from 'eslint-plugin-react-hooks';

import { noPhysicalTailwind } from './no-physical-tailwind.js';

const scopedPhysicalRule = {
  ...noPhysicalTailwind,
  create(context) {
    // المسار المطلق بيحافظ على النطاق سواء ESLint اشتغل من الجذر أو من جوه الحزمة.
    const filename = context.filename.replaceAll('\\', '/');
    if (!/(?:^|\/)(?:apps\/|packages\/ui\/)/.test(filename)) return {};
    return noPhysicalTailwind.create(context);
  },
};

export const frontendConfig = [
  {
    files: ['**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'pospay-rtl': { rules: { 'no-physical-tailwind': scopedPhysicalRule } } },
    rules: { 'pospay-rtl/no-physical-tailwind': 'error' },
  },
];
