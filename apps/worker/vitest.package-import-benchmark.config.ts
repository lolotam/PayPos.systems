import { defineConfig } from 'vitest/config';
import base from './vitest.config.ts';

// Full-bound financial import is opt-in; ordinary worker tests never select it.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['src/modules/orders/__tests__/package-import-commit-full-bound.benchmark.ts'],
  },
});
