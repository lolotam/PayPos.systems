import type { ConsumableProposal } from '../domain/discount-approval-rules.ts';
import type { TermsHashPort } from './discount-request.port.ts';

/** الطلب المقفل كما يُقرأ للاستهلاك: صفه مع معرّفه. */
export type LockedDiscountProposal = ConsumableProposal & { id: string };

/** قفل طلبات الموافقة واستهلاكها داخل معاملة السطر نفسها (FR-019). */
export interface DiscountConsumptionPort {
  /**
   * يقفل طلبات الموافقة بترتيب تصاعدي حتى لا يتناكس مستهلكان على نفس الطلب.
   *
   * @param proposalIds معرّفات الطلبات كما أرسلها العميل
   * @returns الطلبات الموجودة في هذا النشاط والقابلة للاستهلاك، والمجهول أو الأجنبي غائب عنها
   */
  lock(proposalIds: readonly string[]): Promise<LockedDiscountProposal[]>;
  /**
   * ينقل الطلب من الموافَق عليه إلى المستهلَك باسم البند الذي استهلكه.
   *
   * @param proposalId معرّف الطلب المستهلَك
   * @param lineId معرّف البند الذي استهلكه
   * @param termsHash بصمة شروط السطر كما حُسبت عند الكتابة
   * @param at لحظة الاستهلاك بعد الأقفال
   * @returns هل انتقل صف واحد بالضبط، و false يعني أن شيئاً آخر غيّر الطلب
   */
  consume(proposalId: string, lineId: string, termsHash: string, at: Date): Promise<boolean>;
  /** تجزئة الشروط؛ الـ domain لا يستورد `node:crypto`، فالمحوّل يجيبها. */
  hash: TermsHashPort;
}
