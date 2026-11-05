import { SessionError } from '../../domain/session-error.ts';
import { assignPackageSlots, assertPackageRedemptionAllowed, type PackagePreparedDraft, type PackageSlotCandidate } from '../../domain/package-redemption.ts';
import type { PackageSessionDraft, SessionLine } from '../../domain/session-types.ts';
import type { PackageRedemptionWrite } from '../../ports/package-redemption.port.ts';
import type { SessionTransaction } from '../../ports/service-session-transactions.port.ts';

/** جلسة باقة مقفولة ومختارة، جاهزة للتحضير والكتابة. */
export interface PackageRedemptionFact {
  entitlement_id: string;
  component_id: string;
  slot_id: string;
  ordinal: number;
  unit_value: bigint;
  /** هوية صف الاسترداد الذي سيُكتب مع سطر الزيارة. */
  redemption_id: string;
  /** آخر يوم تُقبل فيه الزيارة؛ يُعاد فحصه على اللحظة النهائية. */
  expires_on: string;
  /** لحظة بيع الباقة؛ الباقة المستوردة بلا وقت بيع. */
  sold_at: Date | null;
}

/** مسودة الباقة بعد قفل المكوّن: تحمل مكوّنها وحقائق صلاحيتها. */
type ScopedPackageDraft = PackageSessionDraft & { component_id: string; expires_on: string; sold_at: Date | null };

/**
 * يقفل استحقاقات الباقة ويختار لكل مسودة أقل جلسة حرة، ويمنع الباقة المنتهية أو التي لم تُبَع بعد.
 * القاعدة: الاستحقاق لعميلة أخرى أو لغير هذه الخدمة يُرفض بلا كشف لسببه، والجلسة المختارة تُقفل بصفها.
 *
 * @param tx معاملة الزيارة المفتوحة
 * @param input عميلة الزيارة ومسوداتها وتاريخها ولحظتها ومولّد الهوية
 * @returns حقيقة الجلسة المختارة لكل مسودة بترتيب الطلب
 */
export async function resolvePackageRedemptions(
  tx: SessionTransaction,
  input: { customerId: string; drafts: readonly PackageSessionDraft[]; newId: () => string },
): Promise<Map<number, PackageRedemptionFact>> {
  if (input.drafts.length === 0) return new Map();
  const snapshots = await tx.packages.lock(input.customerId, input.drafts.map((draft) => ({ entitlement_id: draft.entitlement_id, service_id: draft.service_id })));
  if (snapshots === null) throw new SessionError('PACKAGE_NOT_USABLE_HERE');
  const scoped = input.drafts.map((draft, index) => {
    const snapshot = snapshots[index];
    if (snapshot === undefined) throw new SessionError('PACKAGE_NOT_USABLE_HERE');
    return { ...draft, component_id: snapshot.component_id, expires_on: snapshot.expires_on, sold_at: snapshot.sold_at };
  });
  const wanted = new Map<string, number>();
  for (const draft of scoped) wanted.set(draft.component_id, (wanted.get(draft.component_id) ?? 0) + 1);
  const slots = await tx.packages.freeSlots([...wanted].map(([component_id, count]) => ({ component_id, count })));
  const assigned = assignPackageSlots(scoped, slots);
  const chosen: { draft: ScopedPackageDraft; candidate: PackageSlotCandidate }[] = [];
  for (const draft of scoped) {
    const candidate = assigned.get(draft.input_index);
    if (candidate === undefined) throw new SessionError('PACKAGE_NO_FREE_SESSION', { input_index: draft.input_index });
    chosen.push({ draft, candidate });
  }
  // الجلسات المختارة تُقفل كلها بجملة واحدة مرتبة بالمعرّف، فلا انتظار متبادل ولا استعلام لكل سطر.
  chosen.sort((left, right) => (left.candidate.id < right.candidate.id ? -1 : 1));
  const locked = await tx.packages.lockSlots(chosen.map((entry) => entry.candidate.id));
  const lockedById = new Map(locked.map((slot) => [slot.id, slot]));
  const facts = new Map<number, PackageRedemptionFact>();
  for (const { draft, candidate } of chosen) {
    const slot = lockedById.get(candidate.id);
    if (slot === undefined) throw new SessionError('PACKAGE_NO_FREE_SESSION', { input_index: draft.input_index });
    facts.set(draft.input_index, { entitlement_id: draft.entitlement_id, component_id: draft.component_id,
      slot_id: slot.id, ordinal: slot.ordinal, unit_value: slot.unit_value, redemption_id: input.newId(),
      expires_on: draft.expires_on, sold_at: draft.sold_at });
  }
  return facts;
}

/**
 * يعيد فحص صلاحية الباقة على لحظة الزيارة النهائية.
 * القاعدة: الساعة تُقرأ بعد القفل، فقد تتأخر اللحظة عن قفل المكوّن وتغيّر يوم الزيارة،
 * فيُعاد فحص الانتهاء على اللحظة نفسها التي ستُحفظ بها الزيارة.
 *
 * @param facts حقيقة الجلسة المختارة لكل مسودة
 * @param visitLocalDate تاريخ الزيارة بيومها بتوقيت فرع الخدمة
 * @param occurredAt لحظة الزيارة الفعلية بعد التطبيع
 * @returns لا شيء؛ ترمي رمز الرفض المناسب إذا انتهت الباقة أو سبقت البيع
 */
export function assertPackageFactsAllowed(
  facts: ReadonlyMap<number, PackageRedemptionFact>,
  visitLocalDate: string,
  occurredAt: Date,
): void {
  for (const fact of facts.values()) {
    assertPackageRedemptionAllowed({ expiresOn: fact.expires_on, soldAt: fact.sold_at }, visitLocalDate, occurredAt);
  }
}

/**
 * يحوّل الحقائق المختارة إلى مسودات باقة تحمل قيمة جلستها وهوياتها.
 *
 * @param drafts مسودات الباقة بترتيب الطلب
 * @param facts حقيقة الجلسة المختارة لكل مسودة
 * @returns مسودات الباقة الجاهزة للتحضير
 */
export function packagePreparedDrafts(
  drafts: readonly PackageSessionDraft[],
  facts: ReadonlyMap<number, PackageRedemptionFact>,
): PackagePreparedDraft[] {
  return drafts.map((draft) => {
    const fact = facts.get(draft.input_index);
    if (fact === undefined) throw new SessionError('PACKAGE_NOT_USABLE_HERE', { input_index: draft.input_index });
    return { ...draft, unit_value: fact.unit_value,
      redemption: { id: fact.redemption_id, entitlement_id: fact.entitlement_id, component_id: fact.component_id,
        slot_id: fact.slot_id, ordinal: fact.ordinal } };
  });
}

/**
 * يبني صفوف الاسترداد والجلسات المستهلكة من البنود المحفوظة.
 * القاعدة: صف الاسترداد يشير إلى سطره، والجلسة تشير إلى صف الاسترداد، والاثنان في معاملة الزيارة.
 *
 * @param lines البنود المحفوظة من الزيارة
 * @param redeemedAt لحظة كتابة الاسترداد؛ وهي لحظة تسجيل الزيارة عند التسجيل (FR-026)
 * @param recordedBy هوية المسجلة
 * @param recordedByMembershipId عضوية المسجلة
 * @returns صفوف الاسترداد والجلسات التي تُنقل إلى USED
 */
export function packageRedemptionWrites(
  lines: readonly SessionLine[],
  redeemedAt: Date,
  recordedBy: string,
  recordedByMembershipId: string,
): { redemptions: PackageRedemptionWrite[]; slots: { slot_id: string; redemption_id: string }[] } {
  const redemptions = lines.flatMap((line): PackageRedemptionWrite[] => {
    const redemption = line.redemption;
    if (redemption === undefined) return [];
    return [{ redemption_id: redemption.id, entitlement_id: redemption.entitlement_id, component_id: redemption.component_id,
      slot_id: redemption.slot_id, line_id: line.id, redeemed_at: redeemedAt, recorded_by: recordedBy,
      recorded_by_membership_id: recordedByMembershipId }];
  });
  return { redemptions, slots: redemptions.map((row) => ({ slot_id: row.slot_id, redemption_id: row.redemption_id })) };
}
