import { loadEnvConfig } from '@next/env';

export function loadRepoEnv(repoRoot: string): void {
  // Next يحمّل بيئة التطبيق أولاً؛ إعادة التحميل تتيح قراءة بيئة جذر المستودع.
  loadEnvConfig(repoRoot, process.env.NODE_ENV !== 'production', console, true);
}
