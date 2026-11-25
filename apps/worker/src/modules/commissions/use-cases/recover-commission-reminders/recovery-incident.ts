import {
  COMMISSION_REMINDER_ALERT_SCHEDULES_LOST,
  COMMISSION_REMINDER_SCHEDULES_LOST_CODE,
} from '@pospay/domain';

import {
  REMINDER_RECOVERY_LEASE_TTL_SECONDS,
  REMINDER_RECOVERY_PAGE_DEADLINE_MS,
  REMINDER_RECOVERY_SLOT_TTL_SECONDS,
  dueRecoverySlot,
} from '../../domain/reminder-recovery.ts';
import type { ReminderSlot } from '../../domain/reminder-recovery.ts';
import { bounded, type RecoveryProgress } from './recovery-bounds.ts';
import type {
  PassContext,
  RecoverCommissionRemindersDeps,
  RecoveryIncident,
} from './recovery-types.ts';

/**
 * الفتحة المستحقة دلوقتي من مرساة معيّنة (صفر كحد أدنى، لأن المسار الشغّال دلوقتي هو
 * محاولة الفتحة دي بنفسه).
 *
 * @param deps   الساعة
 * @param anchor مرساة الجدولة بصيغة ISO
 * @returns رقم الفتحة المستحقة
 */
function dueNow(deps: RecoverCommissionRemindersDeps, anchor: string): number {
  const anchorMs = Date.parse(anchor);
  if (Number.isNaN(anchorMs)) return 0;
  return dueRecoverySlot(deps.clock.now().getTime() - anchorMs);
}

/**
 * هل الفتحة المسجّلة تُعفى من الرفض؟ المشغّل بيتخطّاه دايمًا (شخص طلب دلوقتي)، والبداية
 * الأولى لجيل Redis بتتخطّاه مرة واحدة بس: أي بداية تانية في نفس الجيل (replica تاني أو
 * إعادة تشغيل بعد محاولة فاشلة) بتلتزم بالإيقاع المشترك (البند 4 من #1222).
 *
 * @param ctx  سياق المسار
 * @param slot السجل الموجود
 * @returns هل يتخطّى الرفض
 */
function exemptFromRefusal(ctx: PassContext, slot: ReminderSlot): boolean {
  if (ctx.mode === 'OPERATOR') return true;
  return ctx.mode === 'STARTUP' && slot.startupRunId !== ctx.runId;
}

/** حقول مسار البداية المحفوظة داخل سجل الإيقاع. */
type StartupSlotFields = Pick<ReminderSlot, 'startupRunId' | 'startupAnchor' | 'startupSlot'>;

/** يبني حقول البداية لمحاولة في الوضع `STARTUP` دون الاعتماد على مرساة حادثة أخرى. */
function nextStartupMeta(
  deps: RecoverCommissionRemindersDeps,
  ctx: PassContext,
  previous: ReminderSlot | null,
): StartupSlotFields {
  if (ctx.mode !== 'STARTUP') {
    return {
      ...(previous?.startupRunId === undefined ? {} : { startupRunId: previous.startupRunId }),
      ...(previous?.startupAnchor === undefined ? {} : { startupAnchor: previous.startupAnchor }),
      ...(previous?.startupSlot === undefined ? {} : { startupSlot: previous.startupSlot }),
    };
  }
  const sameGen = previous?.startupRunId === ctx.runId;
  const startupAnchor = sameGen
    ? (previous.startupAnchor ?? previous.anchor)
    : deps.clock.now().toISOString();
  const prevSlot =
    previous?.startupSlot ?? (sameGen && previous.incidentId === null ? previous.slot : 0);
  const startupSlot = sameGen ? Math.max(dueNow(deps, startupAnchor), prevSlot) : 0;
  return { startupRunId: ctx.runId, startupAnchor, startupSlot };
}

/**
 * يكتب سجل الإيقاع تحت فحص ملكية المسار. حقول البداية (`startupRunId`/`startupAnchor`/`startupSlot`)
 * بتتسجل لما البداية تشتغل، وتتحفظ أثناء ربط أي حادثة في الجيل نفسه.
 *
 * @param deps     المتجر
 * @param ctx      سياق المسار
 * @param previous السجل السابق (لحفظ سجل البداية)
 * @param record   الحادثة والمرساة والفتحة الجديدة
 * @param startup  تحديث اختياري لحقول البداية
 * @returns هل الكتابة نجحت
 */
async function writeSlot(
  deps: RecoverCommissionRemindersDeps,
  ctx: PassContext,
  previous: ReminderSlot | null,
  record: { incidentId: string | null; anchor: string; slot: number },
  startup?: StartupSlotFields,
): Promise<boolean> {
  const inherited: StartupSlotFields =
    startup ??
    (ctx.mode === 'STARTUP' && previous?.startupRunId !== ctx.runId
      ? nextStartupMeta(deps, ctx, previous)
      : {
          ...(previous?.startupRunId === undefined ? {} : { startupRunId: previous.startupRunId }),
          ...(previous?.startupAnchor === undefined
            ? {}
            : { startupAnchor: previous.startupAnchor }),
          ...(previous?.startupSlot === undefined ? {} : { startupSlot: previous.startupSlot }),
        });
  return deps.store.writeSlot({
    passId: ctx.passId,
    slot: { ...record, ...inherited },
    ttlSeconds: REMINDER_RECOVERY_SLOT_TTL_SECONDS,
  });
}

/** يطبّق إيقاع وضع البداية على المسار بلا حادثة حتى مع وجود سجل لحادثة سابقة مغلقة. */
async function paceStartupWithoutIncident(
  deps: RecoverCommissionRemindersDeps,
  ctx: PassContext,
  slot: ReminderSlot,
): Promise<'REFUSED_PACING' | 'LOST_OWNERSHIP' | null> {
  const sameGen = slot.startupRunId === ctx.runId;
  const sAnchor = sameGen ? (slot.startupAnchor ?? slot.anchor) : deps.clock.now().toISOString();
  const sSlot = slot.startupSlot ?? (slot.incidentId === null ? slot.slot : 0);
  if (!exemptFromRefusal(ctx, slot) && sSlot >= dueNow(deps, sAnchor)) return 'REFUSED_PACING';
  const startup = nextStartupMeta(deps, ctx, slot);
  const nextAnchor = startup.startupAnchor ?? deps.clock.now().toISOString();
  const nextSlot = startup.startupSlot ?? 0;
  const written = await writeSlot(
    deps,
    ctx,
    slot,
    { incidentId: null, anchor: nextAnchor, slot: nextSlot },
    startup,
  );
  return written ? null : 'LOST_OWNERSHIP';
}

/**
 * الإيقاع بعد القراءة تحت الملكية (البنود 4 إلى 6 من #1222): السجل بيتقارن بالحادثة
 * المتحققة بس، ووضع البداية بيحتفظ بمساره المستقل عبر `startupRunId`/`startupAnchor`.
 *
 * @param deps القارئات والمتجر
 * @param ctx  سياق المسار (الحادثة المتحققة فيه لو اتحددت)
 * @returns `REFUSED_PACING` أو `LOST_OWNERSHIP` أو null
 */
export async function paceSlot(
  deps: RecoverCommissionRemindersDeps,
  ctx: PassContext,
): Promise<'REFUSED_PACING' | 'LOST_OWNERSHIP' | null> {
  const slot = await deps.store.readSlot();
  const verifiedId = ctx.incident?.id ?? null;
  if (slot !== null && ctx.incident === null && ctx.mode === 'STARTUP') {
    return paceStartupWithoutIncident(deps, ctx, slot);
  }
  if (slot !== null && slot.incidentId === verifiedId) {
    const due = dueNow(deps, slot.anchor);
    if (!exemptFromRefusal(ctx, slot) && slot.slot >= due) return 'REFUSED_PACING';
    const written = await writeSlot(deps, ctx, slot, {
      incidentId: verifiedId,
      anchor: slot.anchor,
      slot: Math.max(due, slot.slot),
    });
    return written ? null : 'LOST_OWNERSHIP';
  }
  // مرور بلا حادثة غير البداية ما بيلمسش سجل حادثة تانية: خسارة جديدة ما بتتأخرش بحادثة اتقفلت.
  if (slot !== null && ctx.incident === null) return null;
  const anchor = ctx.incident?.raisedAt.toISOString() ?? deps.clock.now().toISOString();
  const startup = ctx.mode === 'STARTUP' ? nextStartupMeta(deps, ctx, slot) : undefined;
  const written = await writeSlot(
    deps,
    ctx,
    slot,
    {
      incidentId: verifiedId,
      anchor,
      slot: ctx.incident === null ? 0 : Math.max(0, dueNow(deps, anchor)),
    },
    startup,
  );
  return written ? null : 'LOST_OWNERSHIP';
}

/**
 * يربط المسار بالحادثة المتحققة تحت الملكية (ADR-0061 §4 الخطوة 2): يسجّلها في الإيجار،
 * ويبطل الشهادة **قبل** أي مسح، ويربط سجل الإيقاع بمرساتها لو كان تابع لحادثة تانية.
 *
 * @param deps     القارئات والمتجر
 * @param ctx      سياق المسار
 * @param incident الحادثة المتبنّاة أو المرفوعة
 * @returns هل كل الكتابات المشتركة نجحت (الفشل معناه فقد الملكية)
 */
export async function bindIncident(
  deps: RecoverCommissionRemindersDeps,
  ctx: PassContext,
  progress: RecoveryProgress,
  incident: RecoveryIncident,
): Promise<boolean> {
  const limit = deps.pageDeadlineMs ?? REMINDER_RECOVERY_PAGE_DEADLINE_MS;
  ctx.incident = incident;
  const attached = await bounded(deps, progress, 'set-incident', limit, () =>
    deps.store.setIncident(ctx.passId, incident.id, REMINDER_RECOVERY_LEASE_TTL_SECONDS),
  );
  if (!attached) return false;
  const invalidated = await bounded(deps, progress, 'invalidate-sentinel', limit, () =>
    deps.store.invalidateSentinel(ctx.passId),
  );
  if (!invalidated) return false;
  const slot = await bounded(deps, progress, 'read-slot', limit, () => deps.store.readSlot());
  if (slot?.incidentId === incident.id) return true;
  const anchor = incident.raisedAt.toISOString();
  return bounded(deps, progress, 'write-slot', limit, () =>
    writeSlot(deps, ctx, slot, {
      incidentId: incident.id,
      anchor,
      slot: Math.max(0, dueNow(deps, anchor)),
    }),
  );
}

/**
 * يرفع حادثة الخسارة ويتبنّاها: يجدّد الإيجار قبل الرفع مباشرة لتأكيد الملكية، ثم
 * `INSERT … ON CONFLICT DO NOTHING` (علم مفتوح واحد للكود)، ولو الإدخال ما رجّعش صف
 * يقرأ العلم المفتوح في جملة جديدة ويتبنّاه (P3-2 وP2-4).
 *
 * @param deps     القارئات والمولّد والسجل
 * @param ctx      سياق المسار
 * @param progress تتبّع التقدّم والمهل
 * @returns الحادثة المتبنّاة (وفي سياق المسار)، أو null لو الملكية اتفقدت أو العلم اتقفل
 */
export async function raiseIncident(
  deps: RecoverCommissionRemindersDeps,
  ctx: PassContext,
  progress: RecoveryProgress,
): Promise<RecoveryIncident | null> {
  const limit = deps.pageDeadlineMs ?? REMINDER_RECOVERY_PAGE_DEADLINE_MS;
  const stillOwner =
    !ctx.keeper.lost &&
    (await bounded(deps, progress, 'renew-before-raise', limit, () => ctx.keeper.renew()));
  if (!stillOwner) return null;
  const id = deps.ids.newId();
  const raised = await bounded(deps, progress, 'raise-flag', limit, () =>
    deps.database.raiseRecoveryFlag(id, COMMISSION_REMINDER_SCHEDULES_LOST_CODE),
  );
  let incident: RecoveryIncident | null = null;
  if (raised.raised) {
    deps.logger.warn(
      { code: COMMISSION_REMINDER_ALERT_SCHEDULES_LOST, incidentId: id },
      'commission reminder recovery alert',
    );
    incident = { id, raisedAt: raised.raisedAt ?? deps.clock.now() };
  } else {
    const flags = await bounded(deps, progress, 'open-flags', limit, () =>
      deps.database.openRecoveryFlags(),
    );
    const open = flags.find((flag) => flag.code === COMMISSION_REMINDER_SCHEDULES_LOST_CODE);
    if (open !== undefined) incident = { id: open.id, raisedAt: new Date(open.raisedAt) };
  }
  if (incident === null) return null;
  return (await bindIncident(deps, ctx, progress, incident)) ? incident : null;
}
