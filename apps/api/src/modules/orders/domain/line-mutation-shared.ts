import { assertEditorIsNotPerformer, type LineEditPerformer } from './line-edit-identity.ts';
import type { SessionEditAccess } from './line-edit-editor.ts';
import { SessionError } from './session-error.ts';

interface LineActorFacts {
  denied: boolean;
  feature: boolean;
  eligible: readonly { membership_id: string }[];
}

interface PerformerRow {
  employee_id: string;
  linked_user_id: string | null;
  linked_user_snapshotted: boolean;
}

/**
 * يحوّل حقائق العضوية إلى مدخل اختيار المحررة أو الملغية.
 * الشكل واحد للعمليتين لأن الاختيار يتم على معرّفات العضوية لا على اسم الإذن.
 *
 * @param facts المنع والميزة والعضويات المؤهلة كما قرأها التخزين
 * @returns مدخل resolveSessionEditor أو resolveSessionCanceller
 */
export function lineActorAccess(facts: LineActorFacts): SessionEditAccess {
  return {
    denied: facts.denied,
    feature: facts.feature,
    eligible_membership_ids: facts.eligible.map((actor) => actor.membership_id),
  };
}

/**
 * يختار عضوية الكتابة من الحقائق المؤهلة بعد حسم المعرّف.
 * غيابها رفض موحّد لأن الاختيار لا يعيد تقييم الصلاحية ولا يكشف سبب الغياب.
 *
 * @param facts الحقائق التي تحمل العضويات المؤهلة
 * @param facts.eligible العضويات المؤهلة التي يُبحث فيها عن المعرّف
 * @param membershipId العضوية التي حسمها الاختيار
 * @returns العضوية المختارة كما جاءت في الحقائق
 */
export function selectedLineMembership<T extends { membership_id: string }>(
  facts: { eligible: readonly T[] },
  membershipId: string,
): T {
  const actor = facts.eligible.find((candidate) => candidate.membership_id === membershipId);
  if (actor === undefined) throw new SessionError('FORBIDDEN');
  return actor;
}

/**
 * يبني هوية المنفّذة من لقطة السطر والربط الحالي.
 * الموظفة المحذوفة تبقى لقطتها والربط الحالي null حتى لا يسقط السجل المحتفظ مع الموظفة.
 *
 * @param rows لقطات المنفّذات على السطر أو في صف الإزالة
 * @param current الموظفات الموجودات وقت القراءة
 * @returns هويات المقارنة؛ الربط الحالي null إذا لم تُوجد الموظفة
 */
export function linePerformerIdentities(
  rows: readonly PerformerRow[],
  current: readonly { id: string; user_id: string | null }[],
): LineEditPerformer[] {
  return rows.map((performer) => ({
    linked_user_id: performer.linked_user_id,
    linked_user_snapshotted: performer.linked_user_snapshotted,
    current_user_id: current.find((employee) => employee.id === performer.employee_id)?.user_id ?? null,
  }));
}

/**
 * يرفض النسخة القديمة بعد خسارة المقارنة، ويعيد النسخة الحية إن بقي السطر في النطاق.
 * السطر الذي يختفي بين القفل والرفض يُرفض منعاً موحّداً حتى لا يكشف وجوده خارج الفرع.
 *
 * @param load إعادة قراءة السطر المقفول
 * @returns لا يرجع؛ يرمي SESSION_LINE_REVISION_STALE أو FORBIDDEN
 */
export async function refuseStaleLine(load: () => Promise<{ revision: number } | null>): Promise<never> {
  const fresh = await load();
  if (fresh === null) throw new SessionError('FORBIDDEN');
  throw new SessionError('SESSION_LINE_REVISION_STALE', { current_revision: fresh.revision });
}

/**
 * يطبّق قاعدة «لا تكتب على سطر أنت منفّذته» على كل كتّاب السطر، بنفس دالة التعديل.
 * الرمز المفقود للّقطة يُترجم هنا إلى الرمز المشترك بين الإلغاء وتغيير المنفّذين، لأن جملة التعديل نفسها
 * لا تصلح لكتّاب آخرين؛ الدالة لا تقرّر أي مجموعة هوية ولا تراها.
 *
 * @param actorUserId المستخدم الفاعل: الملغية أو صاحبة التغيير
 * @param performers هوية المنفّذات المجمّعة: الحالية والمتبقية والمطلوبة
 * @returns لا شيء؛ التطابق أو غياب اللقطة يرفض
 */
export function assertActorIsNotPerformer(
  actorUserId: string,
  performers: readonly LineEditPerformer[],
): void {
  try {
    assertEditorIsNotPerformer(actorUserId, performers);
  } catch (error) {
    if (error instanceof SessionError && error.code === 'SESSION_EDIT_IDENTITY_UNKNOWN') {
      throw new SessionError('SESSION_LINE_IDENTITY_UNKNOWN');
    }
    throw error;
  }
}
