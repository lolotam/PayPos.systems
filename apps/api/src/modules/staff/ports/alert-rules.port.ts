import type { Tx } from '@pospay/db';
import type {
  AlertKind,
  AlertRecipientRole,
  EffectiveAlertRule,
  TeamAlertContact,
} from '@pospay/domain';

/**
 * قواعد التنبيه اللي settings صاحبه، بتتقري جوه معاملة المُرسِل نفسها (spec 060 D-B13، FR-B17).
 * الموديول بيملك البورت والمهايّن في.persistence هما اللي بيعرفوا settings وidentity.
 */
export interface AlertRulesPort {
  /**
   * القاعدة الفعلية لنوع واحد في نطاق الحدث، بالمفتاح العام مطبّق: قاعدة الفرع لو الحدث ليه فرع وفيه قاعدة،
   * وإلا قاعدة النشاط، وإلا الافتراضي. المُرسِل بيحتاجها عشان يعرف المستلمين والقنوات قبل ما يبعت الحدث.
   *
   * @param tx        معاملة الشركة بتاعة المُرسِل
   * @param companyId الشركة
   * @param scope     نشاط الحدث وفرعه
   * @param scope.businessId نشاط الحدث
   * @param scope.branchId   فرع الحدث أو null
   * @param kind      نوع التنبيه
   * @returns القاعدة الفعلية؛ المقفولة ماعندهاش مستلمين ولا قنوات
   */
  rule(
    tx: Tx,
    companyId: string,
    scope: { businessId: string; branchId: string | null },
    kind: AlertKind,
  ): Promise<EffectiveAlertRule>;
  /**
   * حازمو أدوار النظام في نطاق الفرع: عضوية نشطة بتغطيه (شركة أو نشاط أو فرع) بدور من القواعد.
   * المُرسِل بيحتاجهم عشان أدوار القاعدة تزود مستلمين جنب المستلم الثابت.
   *
   * @param tx        معاملة الشركة بتاعة المُرسِل
   * @param companyId الشركة
   * @param scope     نشاط الحدث وفرعه
   * @param scope.businessId نشاط الحدث
   * @param scope.branchId   فرع الحدث
   * @param roles     أكواد الأدوار المختارة في القاعدة
   * @param at        لحظة سريان العضوية
   * @returns المستخدمون الحائزون لأحد الأدوار وهل كل واحد منهم مالك
   */
  roleHolders(
    tx: Tx,
    companyId: string,
    scope: { businessId: string; branchId: string },
    roles: readonly AlertRecipientRole[],
    at: Date,
  ): Promise<readonly { userId: string; owner: boolean }[]>;
  /**
   * جهات اتصال المستلمين للبريد والواتساب من دالة القراءة المحدودة (ADR-0003 §6a، AL-Q6) على معاملة المُرسِل نفسها؛
   * مطلوبة لما قناة خارجية تتفعّل بس، وغيابها معها خطأ تركيب ظاهر.
   *
   * @param tx        معاملة الشركة بتاعة المُرسِل
   * @param companyId الشركة
   * @param userIds   المستلمين
   * @param at        لحظة سريان العضوية
   * @returns جهة اتصال لكل مستخدم عنده وجهة صالحة
   */
  contacts?(
    tx: Tx,
    companyId: string,
    userIds: readonly string[],
    at: Date,
  ): Promise<ReadonlyMap<string, TeamAlertContact>>;
}
