import { systemUuidV7 } from '@pospay/ids';
import type postgres from 'postgres';

import type { DataStep, DataStepApp, DataStepCoverage, DataStepEntry, DataStepContext, DataSteps } from './coverage.ts';
import { buildStepApp, reviewStep } from './coverage.ts';
import { createDatabase } from '../client.ts';
import { createOutboxDispatcherDatabase } from '../dispatcher.ts';
import {
  assignEmployeeNumbers,
  EmployeeNumbersExhaustedError,
  EmployeeNumbersRoleRefusedError,
} from './employee-numbers.ts';
import { MigrationRoleRefusedError, rekeyEmployeeNameKeys } from './employee-name-keys.ts';
import {
  cleanStatementAlertRoles,
  StatementAlertRolesRoleRefusedError,
} from './statement-alert-roles.ts';
import {
  discoverRatingClaims,
  RatingDiscoveryRoleRefusedError,
} from './rating-claims-discovery.ts';
import {
  clampStaffMonthsBack,
  StaffMonthsBackRoleRefusedError,
} from './staff-months-back.ts';

export {
  clampStaffMonthsBack,
  StaffMonthsBackRoleRefusedError,
  type StaffMonthsBackResult,
} from './staff-months-back.ts';

// قاعدة لمؤلفي خطوات البيانات (ADR-0038 + ADR-0054 §5): اتصال المالك لغرضه الوحيد فقط — فحص
// الدور وقراءة companies.id؛ كل قراءة tenant وكل كتابة تعيش داخل withTenant على الكائن الضيق
// الذي يبنيه السجل من إعلان الخطوة. الخطوة لا تكتب صفوف tenant عبر اتصال المالك إطلاقًا —
// كتابة مغطّاة عبر المالك تتجاوز الإبطال وهي مرفوضة في المراجعة، ومسح المصدر يمنع أي ملف خطوة
// استيراد أو استدعاء أي مصنع اتصال من حزمة db (createDatabase وpostgres وcreateOutboxDispatcherDatabase
// وcreateCoverageIssuer وcreatePlatformWhatsappDatabase وcreatePlatformEmailDatabase
// وcreateAuthDatabase وcreateStaffOtpDatabase).

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
    error instanceof EmployeeNumbersExhaustedError ||
    error instanceof StatementAlertRolesRoleRefusedError ||
    error instanceof StaffMonthsBackRoleRefusedError
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

/**
 * يبني واجهة التطبيق للخطوة من إعلانها المراجَع وحده: هذه هي نقطة الالتفاف الوحيدة بين الإعلان
 * والـDatabase التي تستلمها الخطوة، فالإعلان INVALIDATES يعني بالضرورة واجهة مغلّفة بالإبطال
 * (ADR-0054 §5). أجسام الخطوات لا تلمس createDatabase إطلاقًا.
 *
 * @param ownerUrl    رابط المالك لبناء رابط pospay_app منه
 * @param appPassword باسورد pospay_app لحاوية migrate
 * @param coverage    إعلان الخطوة المراجَع في السجل
 * @returns واجهة التطبيق، مغلّفة بالإبطال لو الإعلان INVALIDATES
 */
function stepAppDatabase(ownerUrl: string, appPassword: string, coverage: DataStepCoverage) {
  const app = createDatabase({
    url: appDatabaseUrl(ownerUrl, appPassword),
    ids: systemUuidV7(),
    maxConnections: 1,
  });
  return buildStepApp(app, systemUuidV7(), coverage);
}

/**
 * الخطوات المراجَعة: كل قيد مكتوب بإعلانه صراحةً، وجسمه يستلم واجهة التطبيق الجاهزة ولا يبني واحدة
 * بنفسه — قيمة الإعلان هي مصدر الحقيقة الوحيد للاغلاف (ADR-0054 §5).
 */
export const REVIEWED_DATA_STEPS: Readonly<Record<string, DataStepEntry>> = {
  'rating-claims-discovery': {
    coverage: 'NONE',
    run: async (owner, app, context) => {
      const reader = context.openDispatcherReader?.();
      if (reader === undefined)
        throw new Error('RATING_CLAIMS_DISCOVERY_DISPATCHER_CONFIGURATION');
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
    },
  },
  'employee-numbers': {
    coverage: 'NONE',
    run: async (owner, app) => {
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
  },
  'statement-alert-roles': {
    coverage: 'NONE',
    run: async (owner, app) => {
      const ids = systemUuidV7();
      try {
        const { companies, read, cleaned } = await cleanStatementAlertRoles(owner, app, ids);
        console.log(`companies=${companies} read=${read} cleaned=${cleaned}`);
      } catch (error) {
        throw sanitizedStepError('statement-alert-roles', error);
      } finally {
        await app.close();
      }
    },
  },
  'employee-name-keys': {
    coverage: 'NONE',
    run: async (owner, app) => {
      try {
        const { companies, read, updated } = await rekeyEmployeeNameKeys(owner, app);
        console.log(`companies=${companies} read=${read} updated=${updated}`);
      } catch (error) {
        throw sanitizedStepError('employee-name-keys', error);
      } finally {
        await app.close();
      }
    },
  },
  'staff-months-back': {
    coverage: 'NONE',
    run: async (owner, app) => {
      try {
        const { companies, read, clamped } = await clampStaffMonthsBack(owner, app);
        console.log(
          `[data-step:staff-months-back] companies=${companies} read=${read} clamped=${clamped}`,
        );
      } catch (error) {
        throw sanitizedStepError('staff-months-back', error);
      } finally {
        await app.close();
      }
    },
  },
};

/**
 * يبني خريطة الخطوات للمشغّل من قيد مراجَع: يرفض القيد غير المراجَع قبل أي جملة (reviewStep)،
 * ثم يقفل جسم كل خطوة على كائن ضيق مبنيّ من قيمة إعلانه هي — لا تُمرَّر قيمة الإعلان للجسم، ولا
 * يبني الجسم واجهته بنفسه. يقفل الـpool اللي بيستلمه الجسم في finally بعد التشغيل حتى لو رمى
 * الجسم (close بلا تفاعل ثاني)، فمفيش pool بيفضل مفتوح من عملية migrate.
 *
 * @param source      القيود المراجَعة (الخطوات الحقيقية أو قيود اختبار)
 * @param ownerUrl    رابط المالك
 * @param appPassword باسورد pospay_app
 * @param context     سياق البناء (رابط المالك وباسورد dispatcher لخطوة واحدة)
 * @param createApp   مصنع واجهة التطبيق؛ الافتراضي يبني على pospay_app ويغلف حسب الإعلان
 * @returns خريطة الخطوات التي يستهلكها applyMigrations
 */
export function materializeDataSteps(
  source: Readonly<Record<string, DataStepEntry>>,
  ownerUrl: string,
  appPassword: string,
  context: Omit<DataStepContext, 'ownerUrl'> = {},
  createApp: (coverage: DataStepCoverage) => DataStepApp = (coverage) =>
    stepAppDatabase(ownerUrl, appPassword, coverage),
): DataSteps {
  const materialized: Record<string, DataStep> = {};
  for (const [name, entry] of Object.entries(source)) {
    reviewStep(name, entry);
    const buildApp = createApp;
    const { dispatcherPassword } = context;
    const runContext: DataStepContext =
      dispatcherPassword === undefined
        ? { ownerUrl }
        : {
            ownerUrl,
            dispatcherPassword,
            openDispatcherReader: () =>
              createOutboxDispatcherDatabase({
                url: dispatcherReaderUrl(ownerUrl, dispatcherPassword),
                maxConnections: 1,
              }),
          };
    materialized[name] = {
      coverage: entry.coverage,
      run: async (owner: postgres.Sql): Promise<void> => {
        const app = buildApp(entry.coverage);
        try {
          return await entry.run(owner, app, runContext);
        } finally {
          await app.close();
        }
      },
    };
  }
  return materialized;
}

/** يبني رابط قارئ dispatcher لخطوة rating-claims-discovery من رابط المالك وباسوردها. */
function dispatcherReaderUrl(ownerUrl: string, dispatcherPassword: string): string {
  const readerUrl = new URL(appDatabaseUrl(ownerUrl, dispatcherPassword));
  readerUrl.username = 'pospay_dispatcher';
  return readerUrl.toString();
}

/** يربط علامات الترحيل بخطوات بيانات معزولة، ويغلق اتصال التطبيق حتى عند فشل الخطوة. */
export function migrationDataSteps(
  ownerUrl: string,
  appPassword: string,
  dispatcherPassword?: string,
): DataSteps {
  return materializeDataSteps(
    REVIEWED_DATA_STEPS,
    ownerUrl,
    appPassword,
    dispatcherPassword === undefined ? {} : { dispatcherPassword },
  );
}
