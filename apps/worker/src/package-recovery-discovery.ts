import type { OutboxDispatcherDatabase } from '@pospay/db';
import type { Logger } from '@pospay/observability';
import type { PackageRecoveryTarget } from './modules/orders/index.ts';

/** المدة بين مسحين: مع نبض الاستعادة (60 ث) وحد العشر دقائق تبقى الاستعادة بعد ضياع Redis في حدود دقائق قليلة. */
const DISCOVERY_INTERVAL_MS = 2 * 60 * 1000;
const COMPANY_PAGE_SIZE = 200;

/** مدخلات المسح: صفحات الشركات الحيّة وأهداف الاستعادة. */
export interface RecoveryDiscoveryOptions {
  readonly listCompanies: (afterId: string | null, pageSize: number) => Promise<readonly string[]>;
  readonly targets: readonly PackageRecoveryTarget[];
  readonly logger: Logger;
  readonly isStopped?: () => boolean;
}

/** نتيجة مسح واحد. */
export interface RecoveryDiscoveryResult {
  readonly companies: number;
  readonly registered: number;
  readonly failures: number;
}

/**
 * يمسح كل الشركات الحيّة مرة: لكل شركة وهدف يفحص الطلبات المعلقة في معاملة قصيرة مستقلة،
 * ويسجّل جدولة الاستعادة لمن عنده طلب (التسجيل idempotent). فشل شركة أو هدف لا يوقف بقية المسح.
 *
 * @param options الصفحات والأهداف والسجل وإشارة الإيقاف
 * @returns عدد الشركات الممسوحة والمسجَّلة والفاشلة
 */
export async function discoverPackageRecoveries(
  options: RecoveryDiscoveryOptions,
): Promise<RecoveryDiscoveryResult> {
  let companies = 0;
  let registered = 0;
  let failures = 0;
  let cursor: string | null = null;
  for (;;) {
    const page = await options.listCompanies(cursor, COMPANY_PAGE_SIZE);
    for (const companyId of page) {
      if (options.isStopped?.() === true) return { companies, registered, failures };
      companies += 1;
      for (const target of options.targets) {
        try {
          if (!(await target.hasPending(companyId))) continue;
          await target.register(companyId);
          registered += 1;
        } catch {
          failures += 1;
          // الخطأ الخام قد يحمل نص الاستعلام ومعاملاته؛ يُسجَّل الهدف فقط، والمسح التالي يعيد المحاولة.
          options.logger.warn({ target: target.name }, 'package recovery discovery failed');
        }
      }
    }
    if (page.length < COMPANY_PAGE_SIZE) return { companies, registered, failures };
    cursor = page[page.length - 1] ?? null;
  }
}

/** مسح الاكتشاف الدوري المشغَّل: يقف ويصرّف المسح الجاري. */
export interface RecoveryDiscoveryLoop {
  /** يوقف المؤقت ويطلب من المسح الجاري التوقف ثم ينتظر انتهاءه. */
  readonly stop: () => Promise<void>;
}

/**
 * يشغّل مسحًا فوريًا غير حاجب عند البدء ثم مسحًا دوريًا بلا تداخل بين مسحين (بيانات Redis الضائعة تُسجَّل ثانيةً
 * خلال دقائق، فلا تنتظر الطلبات العالقة حدثًا جديدًا من الشركة). فشل صفحة الشركات يُسجَّل ويعاد في المسح التالي.
 *
 * @param options الصفحات والأهداف والسجل
 * @param intervalMs المدة بين مسحين (للاختبار)
 * @returns المقبض الذي يوقف المسح عند الإغلاق
 */
export function startPackageRecoveryDiscovery(
  options: Omit<RecoveryDiscoveryOptions, 'isStopped'>,
  intervalMs: number = DISCOVERY_INTERVAL_MS,
): RecoveryDiscoveryLoop {
  let stopped = false;
  let running: Promise<void> | null = null;
  const scan = (): void => {
    if (stopped || running !== null) return;
    running = discoverPackageRecoveries({ ...options, isStopped: () => stopped })
      .then(() => undefined)
      .catch(() =>
        options.logger.warn({ target: 'companies' }, 'package recovery discovery failed'),
      )
      .finally(() => {
        running = null;
      });
  };
  scan();
  const timer = setInterval(scan, intervalMs);
  timer.unref?.();
  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}

/**
 * يشغّل مسح الاكتشاف لعامل بيع الباقات وعامل تثبيت الاستيراد على قائمة الشركات الحيّة من واجهة المرسِل (ADR-0061):
 * إعادة استخدام قارئ معرّفات الشركات نفسه من غير أي منحة أو قراءة جدول جديدة.
 *
 * @param dispatcher واجهة المرسِل التي تقرأ صفحات معرّفات الشركات
 * @param workers العمال الذين يعرضون هدف استعادتهم
 * @param logger السجل
 * @returns المقبض الذي يوقف المسح عند الإغلاق
 */
export function startPackageRecoveryDiscoveryFor(
  dispatcher: Pick<OutboxDispatcherDatabase, 'companyIdPage'>,
  workers: readonly { readonly recoveryTarget: PackageRecoveryTarget }[],
  logger: Logger,
): RecoveryDiscoveryLoop {
  return startPackageRecoveryDiscovery({
    listCompanies: (afterId, pageSize) => dispatcher.companyIdPage(afterId, pageSize),
    targets: workers.map((worker) => worker.recoveryTarget),
    logger,
  });
}
