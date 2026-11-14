import { defineConfig } from 'vitest/config';
import base from './vitest.config.ts';

// Full-bound sale execution is opt-in; ordinary worker tests never select it.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['src/modules/orders/__tests__/package-sale-execution.benchmark.ts'],
  },
});
