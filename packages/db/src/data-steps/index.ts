import { systemUuidV7 } from '@pospay/ids';
import type postgres from 'postgres';

import { createDatabase } from '../client.ts';
import { rekeyEmployeeNameKeys } from './employee-name-keys.ts';

/**
 * يبني رابط pospay_app من رابط المالك؛ الباسورد بيتعمل له encode كامل لأن setter الـ URL
 * بيسيب `%` زي ما هي، فباسورد فيها `%` كانت هتفشل أو تتفك غلط وتوقف الترحيل.
 */
export function appDatabaseUrl(ownerUrl: string, appPassword: string): string {
  const url = new URL(ownerUrl);
  url.username = 'pospay_app';
  url.password = encodeURIComponent(appPassword);
  return url.toString();
}

/**
 * بيحوّل أي فشل في خطوة البيانات لرسالة من غير أسماء: خطأ الاستعلام فيه الأسماء في الـ params،
 * ولو طلع زي ما هو هيتطبع في لوج حاوية الترحيل. بنحتفظ بالـ SQLSTATE بس للتشخيص.
 */
export function sanitizedStepError(step: string, error: unknown): Error {
  const codeOf = (value: unknown): unknown =>
    typeof value === 'object' && value !== null && 'code' in value ? value.code : undefined;
  const cause =
    typeof error === 'object' && error !== null && 'cause' in error ? error.cause : undefined;
  const code = codeOf(error) ?? codeOf(cause);
  const sqlstate = typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : 'unknown';
  return new Error(`Migration data step ${step} failed (sqlstate=${sqlstate})`);
}

/** يربط علامات الترحيل بخطوات بيانات معزولة، ويغلق اتصال التطبيق حتى عند فشل الخطوة. */
export function migrationDataSteps(ownerUrl: string, appPassword: string) {
  return {
    'employee-name-keys': async (owner: postgres.Sql): Promise<void> => {
      const app = createDatabase({
        url: appDatabaseUrl(ownerUrl, appPassword),
        ids: systemUuidV7(),
        maxConnections: 1,
      });
      try {
        const { companies, read, updated } = await rekeyEmployeeNameKeys(owner, app);
        console.log(`companies=${companies} read=${read} updated=${updated}`);
      } catch (error) {
        throw sanitizedStepError('employee-name-keys', error);
      } finally {
        await app.close();
      }
    },
  };
}
