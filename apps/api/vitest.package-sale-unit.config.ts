import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/modules/orders/use-cases/sell-package/__tests__/*.spec.ts'],
  },
});
