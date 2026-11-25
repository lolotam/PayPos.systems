import {
  REMINDER_RECOVERY_PAGE_DEADLINE_MS,
  REMINDER_RECOVERY_PAGE_SIZE,
  REMINDER_RECOVERY_UPSERT_DEADLINE_MS,
} from '../../domain/reminder-recovery.ts';
import {
  RecoveryStalled,
  bounded,
  touchProgress,
  type RecoveryProgress,
} from './recovery-bounds.ts';
import { raiseIncident } from './recovery-incident.ts';
import type { PassContext, RecoverCommissionRemindersDeps } from './recovery-types.ts';

/** نتيجة إعادة البناء: عدد الشركات وعدد الناقصة وعدد المسجَّل. */
export interface RebuildResult {
  readonly companies: number;
  readonly missing: number;
  readonly registered: number;
}

/**
 * يسجّل جدولة كل شركة في صفحة واحدة، عملية عملية بمهلتها ومع تسجيل التقدّم (ADR-0061 §2، §4).
 *
 * @param deps     القارئات والجدولة
 * @param ctx      سياق المسار
 * @param progress تقدّم المسار
 * @param companies معرّفات شركات الصفحة
 * @returns عدد المسجَّل، أو null عند الفشل
 */
async function registerPageCompanies(
  deps: RecoverCommissionRemindersDeps,
  ctx: PassContext,
  progress: RecoveryProgress,
  companies: readonly string[],
): Promise<number | null> {
  const limit = deps.upsertDeadlineMs ?? REMINDER_RECOVERY_UPSERT_DEADLINE_MS;
  let registered = 0;
  for (const companyId of companies) {
    const registration = await bounded(deps, progress, 'upsert', limit, () =>
      deps.schedule.register(companyId),
    );
    if (!registration.registered || ctx.keeper.lost) return null;
    touchProgress(deps, progress);
    registered += 1;
  }
  return registered;
}

/**
 * يعالج صفحة واحدة: يفحص وجود جدولاتها، ولو لقى ناقصة والمسار لسه بلا حادثة يرفعها ويتبنّاها
 * فورًا (يبطل الشهادة ويربط الإيقاع) قبل أي تسجيل، وبعدين يعيد تسجيل كل شركات الصفحة لتحديث
 * جدولتها حتى لو تغيّر إيقاعها (ADR-0061 §2، P3-6).
 *
 * @param deps     القارئات والجدولة
 * @param ctx      سياق المسار
 * @param progress تقدّم المسار
 * @param page     معرّفات الصفحة
 * @returns عدد الناقصة وعدد المسجَّل، أو null عند الفشل
 */
async function rebuildPage(
  deps: RecoverCommissionRemindersDeps,
  ctx: PassContext,
  progress: RecoveryProgress,
  page: readonly string[],
): Promise<{ missing: number; registered: number } | null> {
  const limit = deps.pageDeadlineMs ?? REMINDER_RECOVERY_PAGE_DEADLINE_MS;
  const exists = await bounded(deps, progress, 'schedule-exists', limit, () =>
    deps.schedule.existsAll(page),
  );
  const absent = page.filter((_, index) => exists[index] !== true);
  if (
    absent.length > 0 &&
    ctx.incident === null &&
    (await raiseIncident(deps, ctx, progress)) === null
  ) {
    return null;
  }
  const registered = await registerPageCompanies(deps, ctx, progress, page);
  return registered === null ? null : { missing: absent.length, registered };
}

/**
 * يقرأ كل الشركات ويعيد تسجيل جدولة كل واحدة فيها. كل قراءة صفحة وكل تسجيل ليهم مهلتهم،
 * وفي حد أقصى لفترة بلا تقدّم، وفي مهلة صلبة للمسار كله (البنود 1 من #1222 والخطوة 3 من
 * ADR-0061 §4). أي تعدٍّ بيوقف المسار: المفتاح ما بيتجدّدش والمسار بيرجع null.
 *
 * @param deps     القارئات والمتجر والجدولة
 * @param ctx      سياق المسار
 * @param progress تتبّع التقدّم والمهلة الصلبة
 * @returns النتيجة، أو null عند الفشل أو التوقف
 */
export async function rebuildAll(
  deps: RecoverCommissionRemindersDeps,
  ctx: PassContext,
  progress: RecoveryProgress,
): Promise<RebuildResult | null> {
  const pageLimit = deps.pageDeadlineMs ?? REMINDER_RECOVERY_PAGE_DEADLINE_MS;
  let afterId: string | null = null;
  const total = { companies: 0, missing: 0, registered: 0 };
  try {
    for (;;) {
      if (ctx.keeper.lost) return null;
      const page: readonly string[] = await bounded(deps, progress, 'page', pageLimit, () =>
        deps.database.companyIdPage(afterId, REMINDER_RECOVERY_PAGE_SIZE),
      );
      touchProgress(deps, progress);
      if (page.length === 0) break;
      const done = await rebuildPage(deps, ctx, progress, page);
      if (done === null) return null;
      total.companies += page.length;
      total.missing += done.missing;
      total.registered += done.registered;
      afterId = page[page.length - 1] ?? null;
      if (page.length < REMINDER_RECOVERY_PAGE_SIZE) break;
    }
  } catch (error) {
    if (error instanceof RecoveryStalled) {
      ctx.keeper.stop();
      deps.logger.warn({ operation: error.operation }, 'commission reminder recovery stalled');
      return null;
    }
    throw error;
  }
  const renewed = await bounded(deps, progress, 'renew', pageLimit, () => ctx.keeper.renew());
  return renewed && !ctx.keeper.lost ? total : null;
}
