import { systemUuidV7 } from '@pospay/ids';
import type postgres from 'postgres';

import { createDatabase } from '../client.ts';
import { createOutboxDispatcherDatabase } from '../dispatcher.ts';
import {
  assignEmployeeNumbers,
  EmployeeNumbersExhaustedError,
  EmployeeNumbersRoleRefusedError,
} from './employee-numbers.ts';
import { MigrationRoleRefusedError, rekeyEmployeeNameKeys } from './employee-name-keys.ts';
import {
  discoverRatingClaims,
  RatingDiscoveryRoleRefusedError,
} from './rating-claims-discovery.ts';

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
 * رفض دور الترحيل نصه ثابت ومن غير بيانات، فبيطلع زي ما هو عشان المشغّل يعرف يصلح إيه.
 */
export function sanitizedStepError(step: string, error: unknown): Error {
  if (
    error instanceof MigrationRoleRefusedError ||
    error instanceof RatingDiscoveryRoleRefusedError ||
    error instanceof EmployeeNumbersRoleRefusedError ||
    error instanceof EmployeeNumbersExhaustedError
  )
    return error;
  const codeOf = (value: unknown): unknown =>
    typeof value === 'object' && value !== null && 'code' in value ? value.code : undefined;
  const cause =
    typeof error === 'object' && error !== null && 'cause' in error ? error.cause : undefined;
  const code = codeOf(error) ?? codeOf(cause);
  const sqlstate = typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : 'unknown';
  return new Error(`Migration data step ${step} failed (sqlstate=${sqlstate})`);
}

/** يربط علامات الترحيل بخطوات بيانات معزولة، ويغلق اتصال التطبيق حتى عند فشل الخطوة. */
export function migrationDataSteps(
  ownerUrl: string,
  appPassword: string,
  dispatcherPassword?: string,
) {
  return {
    'rating-claims-discovery': ratingDiscoveryStep(ownerUrl, appPassword, dispatcherPassword),
    'employee-numbers': async (owner: postgres.Sql): Promise<void> => {
      const app = createDatabase({
        url: appDatabaseUrl(ownerUrl, appPassword),
        ids: systemUuidV7(),
        maxConnections: 1,
      });
      try {
        const { companies, read, assigned, exhausted } = await assignEmployeeNumbers(owner, app);
        console.log(
          `companies=${companies} read=${read} assigned=${assigned} exhausted=${exhausted}`,
        );
      } catch (error) {
        throw sanitizedStepError('employee-numbers', error);
      } finally {
        await app.close();
      }
    },
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

function ratingDiscoveryStep(ownerUrl: string, appPassword: string, dispatcherPassword?: string) {
  return async (owner: postgres.Sql): Promise<void> => {
    if (!dispatcherPassword) throw new Error('RATING_CLAIMS_DISCOVERY_DISPATCHER_CONFIGURATION');
    const readerUrl = new URL(appDatabaseUrl(ownerUrl, dispatcherPassword));
    readerUrl.username = 'pospay_dispatcher';
    const reader = createOutboxDispatcherDatabase({
      url: readerUrl.toString(),
      maxConnections: 1,
    });
    const app = createDatabase({
      url: appDatabaseUrl(ownerUrl, appPassword),
      ids: systemUuidV7(),
      maxConnections: 1,
    });
    let failure: Error | undefined;
    try {
      const counts = await discoverRatingClaims(owner, app, reader);
      console.log(`rating_claims_discovery ${JSON.stringify(counts)}`);
    } catch (error) {
      failure = sanitizedStepError('rating-claims-discovery', error);
    }
    const closed = await Promise.allSettled([app.close(), reader.close()]);
    if (failure) throw failure;
    if (closed.some((result) => result.status === 'rejected'))
      throw new Error('RATING_CLAIMS_DISCOVERY_CLOSE_FAILED');
  };
}
