import { defineConfig } from 'vitest/config';

// القواعد الصافية لا تشغّل تهيئة Postgres أو أي اتصال Redis.
export default defineConfig({ test: { include: ['src/modules/commissions/**/coverage-issuance.unit.spec.ts'] } });
