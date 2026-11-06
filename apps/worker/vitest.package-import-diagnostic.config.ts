import { defineConfig } from 'vitest/config';
import base from './vitest.config.ts';

export default defineConfig({
  ...base,
  test: { ...base.test, bail: 1,
    include: ['src/modules/orders/__tests__/package-import-commit.diagnostic.ts'] },
});
