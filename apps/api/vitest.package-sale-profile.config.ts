import { defineConfig } from 'vitest/config';
import base from './vitest.config.ts';

export default defineConfig({
  ...base,
  test: { ...base.test, include: ['src/modules/orders/__tests__/package-sale.diagnostic.ts'] },
});
