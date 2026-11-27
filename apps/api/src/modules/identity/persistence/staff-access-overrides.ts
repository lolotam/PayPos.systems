import type { IdGenerator, Tx } from '@pospay/db';

import { orderOverrideCandidateMemberships } from '../domain/inline-override-candidates.ts';
import {
  permissionEditFailure,
  permissionHolderIsOwner,
  type OverrideTerms,
} from '../domain/permission-edit.ts';
import { overrideLifecycleFailure } from '../domain/permission-override-lifecycle.ts';
import { StaffUserRefused } from '../domain/staff-access-errors.ts';
import { permissionEditorBatch } from './permission-editor-context.ts';
import { currentOverrides, writeOverride } from './permission-override-writer.ts';

/** عضوية موظفة على فرع، مع دورها — مرشحة لكتابة استثناء الصلاحية عليها. */
export interface StaffAccessMembershipCandidate {
  /** معرّف العضوية. */
  readonly membershipId: string;
  /** الفرع اللي العضوية عليها. */
  readonly branchId: string;
  /** دور الموظفة على الفرع. */
  readonly role: string;
}

/**
 * استثناءات الصلاحية المضمّنة في «إعطاء الدخول» (080-b): كل استثناء بيتكتب على أقرب عضوية صالحة
 * له — العضوية اللي نطاقها يطابق نطاق الاستثناء أول، بعدين الأساسية، وبعدها الباقي. أول استثناء
 * مرفوض بيرمي عشان كل الكتابة تتراجع: ما يبقاش عندنا نص منحة ملتومة.
 *
 * @param tx                 معاملة الشركة
 * @param ids                مولّد المعرّفات
 * @param input              الشركة والمنحّ والعضويات والاستثناءات
 * @param input.companyId    الشركة
 * @param input.actorUserId  صاحب المنح
 * @param input.memberships  العضويات المرشحة (الأساسية أول)
 * @param input.overrides    الاستثناءات المطلوبة
 */
export async function applyStaffAccessOverrides(
  tx: Tx,
  ids: IdGenerator,
  input: {
    readonly companyId: string;
    readonly actorUserId: string;
    readonly memberships: readonly StaffAccessMembershipCandidate[];
    readonly overrides: readonly OverrideTerms[];
  },
): Promise<void> {
  if (input.overrides.length === 0) return;
  const seed = input.memberships[0];
  if (seed === undefined) throw new StaffUserRefused('STAFF_ACCESS_OVERRIDE_REFUSED');
  const batch = await permissionEditorBatch(
    tx,
    input.companyId,
    input.actorUserId,
    seed.membershipId,
  );
  for (const terms of input.overrides) {
    await applyOverride(tx, ids, input, batch, terms);
  }
}

/**
 * ترتيب العضويات المرشحة للاستثناء: اللي نطاقها يطابق نطاق الاستثناء الأول، وبعدها الأساسية،
 * وبعدها الباقي — عشان أول تطابق هو اللي بيتقبل. عضوية «إعطاء الدخول» كلها على فروع، فنطاقها
 * نوعه BRANCH ومعرّفه هو معرّف الفرع.
 */
function orderedCandidates(
  memberships: readonly StaffAccessMembershipCandidate[],
  terms: OverrideTerms,
): StaffAccessMembershipCandidate[] {
  return orderOverrideCandidateMemberships(
    memberships.map((membership) => ({
      ...membership,
      scopeType: 'BRANCH' as const,
      scopeId: membership.branchId,
    })),
    terms,
  );
}

/**
 * الاستثناء بيتقيّم على كل عضوية مرشحة: إما التعديل مسموح ودورة القرار مسموحة، أو refusal.
 * لو مفيش ولا عضوية صلحت، بيرمي رفض ثابت واحد عشان ما يتفضحش سبب الرفض.
 *
 * معرّف النطاق بيتطبّع لحروف صغيرة قبل أي مقارنة: UUID مش حساس لحالة الأحرف، فالنطاق
 * المكتوب بحرف كبير لازم يتعامل زي نفس النطاق المكتوب بحرف صغير.
 */
async function applyOverride(
  tx: Tx,
  ids: IdGenerator,
  input: {
    readonly companyId: string;
    readonly actorUserId: string;
    readonly memberships: readonly StaffAccessMembershipCandidate[];
  },
  batch: Awaited<ReturnType<typeof permissionEditorBatch>>,
  terms: OverrideTerms,
): Promise<void> {
  const canonicalTerms: OverrideTerms = { ...terms, scope_id: terms.scope_id.toLowerCase() };
  for (const candidate of orderedCandidates(input.memberships, canonicalTerms)) {
    const context = await batch.forCandidate(candidate.membershipId, canonicalTerms);
    const failure = permissionEditFailure(canonicalTerms, context, 'SAVE');
    if (failure !== null) continue;
    const previous = await currentOverrides(
      tx,
      input.companyId,
      candidate.membershipId,
      canonicalTerms,
      context.now,
    );
    const lifecycle = overrideLifecycleFailure(
      'SAVE',
      previous,
      permissionHolderIsOwner(context),
      context.now,
    );
    if (lifecycle !== null) continue;
    await writeOverride(
      tx,
      ids,
      input,
      candidate.membershipId,
      canonicalTerms,
      previous,
      context.now,
    );
    return;
  }
  throw new StaffUserRefused('STAFF_ACCESS_OVERRIDE_REFUSED');
}
