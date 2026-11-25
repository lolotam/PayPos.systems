import { parseArgs } from 'node:util';
import { createOutboxDispatcherDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { Redis } from 'ioredis';
import postgres from 'postgres';

import {
  checkRecoveryPrerequisites,
} from './commission-reminder-operator.ts';
import {
  createCommissionReminderSchedule,
  createReminderRecoveryStore,
  recoverCommissionReminders,
  reminderRecoveryReaders,
  type RecoveryClearInput,
} from './modules/commissions/index.ts';

/**
 * مشغّل استعادة جدولة التذكيرات (ADR-0061 §7): نفس مسار العامل بالظبط، بياخد
 * `--incident-id` وبيشتغل على الحادثة المسمّاة بس. قبل ما يلمس أي جدولة أو مفتاح Redis
 * أو علامة، بيتأكد إن دالة قراءة الشركات موجودة ومملوكة للدور الصح، وإن سياسة RLS
 * موجودة، وإن نداء الدالة ينجح. لو أي شرط مش متحقق، بيقف فورًا بكود خطأ ثابت
 * ومن غير أي أثر (البند 8 من #1222).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** هوية المشغّل الثابتة اللي بتتسجل في `cleared_by` وسطر التدقيق (ADR-0061 §3). */
const OPERATOR_CLEARED_BY = '00000000-0000-7000-8000-000000000062';

/**
 * يمسح الحادثة المسمّاة بهوية المشغّل في معاملة واحدة مع سطر التدقيق: المسح والتدقيق
 * مع بعض، والحادثة المسمّاة بس (ADR-0061 §3 و§7).
 *
 * @param owner  اتصال صاحب الدور
 * @param input  الحادثة ومعرّف التشغيل ومعرّف المسار وعدد الشركات ومعرّف التدقيق
 * @returns هل اتمسحت
 */
async function clearAsOperator(
  owner: postgres.Sql,
  input: RecoveryClearInput,
): Promise<boolean> {
  return owner.begin(async (tx) => {
    const rows = await tx`UPDATE operational_recovery_flags
      SET cleared_at = clock_timestamp(), cleared_by = ${OPERATOR_CLEARED_BY}::uuid
      WHERE id = ${input.incidentId}::uuid
        AND code = 'COMMISSION_REMINDER_SCHEDULES_LOST' AND cleared_at IS NULL
      RETURNING id`;
    if (rows.length === 0) return false;
    await tx`INSERT INTO platform_audit_log (id, actor, action, details)
      VALUES (${input.auditId}::uuid, 'system:operator', 'recovery.flag_cleared',
        ${tx.json({
          flag_id: input.incidentId,
          code: 'COMMISSION_REMINDER_SCHEDULES_LOST',
          rebuilt_run_id: input.runId,
          rebuilt_pass_id: input.passId,
          companies_rebuilt: input.companiesRebuilt,
          cleared_by: OPERATOR_CLEARED_BY,
        })})`;
    return true;
  });
}

try {
  const { values } = parseArgs({
    options: { 'incident-id': { type: 'string' } },
  });
  const incidentId = values['incident-id'];
  if (!incidentId || !UUID.test(incidentId)) {
    console.error('COMMISSION_REMINDER_RECOVERY_INPUT_INVALID');
    process.exitCode = 1;
  } else {
    const ownerUrl = process.env['MIGRATION_DATABASE_URL'];
    const dispatcherUrl = process.env['DISPATCHER_DATABASE_URL'];
    const redisUrl = process.env['REDIS_URL'];
    if (!ownerUrl || !dispatcherUrl || !redisUrl) {
      console.error('COMMISSION_REMINDER_RECOVERY_CONFIGURATION');
      process.exitCode = 1;
    } else {
      const logger = createLogger('info');
      const ids = systemUuidV7();
      const owner = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
      const dispatcher = createOutboxDispatcherDatabase({ url: dispatcherUrl, maxConnections: 1 });
      const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
      redis.on('error', () => undefined);
      const schedule = createCommissionReminderSchedule({ redisUrl, logger });
      const store = createReminderRecoveryStore(redis);
      let failure: unknown;
      try {
        const prerequisite = await checkRecoveryPrerequisites(
          async (text) => {
            const rows = await owner.unsafe(text);
            return rows as readonly Record<string, unknown>[];
          },
          () => dispatcher.companyIdPage(null, 1),
        );
        if (prerequisite !== null) {
          console.error(prerequisite);
          process.exitCode = 1;
        } else {
          const result = await recoverCommissionReminders(
            {
              database: reminderRecoveryReaders(dispatcher),
              store,
              schedule,
              ids,
              clock: { now: () => new Date() },
              logger,
              release: 'operator',
              clearIncident: (input) => clearAsOperator(owner, input),
            },
            { mode: 'OPERATOR', incidentId },
          );
          console.log(JSON.stringify(result));
          if (result.outcome !== 'PUBLISHED') process.exitCode = 1;
        }
      } catch (error) {
        failure = error;
      }
      const closed = await Promise.allSettled([schedule.close(), dispatcher.close(), owner.end()]);
      redis.disconnect();
      if (failure !== undefined) {
        console.error('COMMISSION_REMINDER_RECOVERY_FAILED');
        process.exitCode = 1;
      }
      if (closed.some((entry) => entry.status === 'rejected')) {
        console.error('COMMISSION_REMINDER_RECOVERY_CLOSE_FAILED');
        process.exitCode = 1;
      }
    }
  }
} catch {
  // الخطأ الخام قد يحمل SQL أو رابط اتصال؛ المشغّل يتلقى رمزًا ثابتًا فقط.
  console.error('COMMISSION_REMINDER_RECOVERY_FAILED');
  process.exitCode = 1;
}
