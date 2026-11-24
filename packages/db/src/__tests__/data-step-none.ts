import type postgres from 'postgres';

// كل خطوة في هذه الاختبارات لا تلمس جدول مصدر مغطّى، فإعلانها NONE الصريح (فحص إعلان التغطية).
export const none = (run: (client: postgres.Sql) => Promise<void>) => ({
  coverage: 'NONE' as const,
  run,
});
