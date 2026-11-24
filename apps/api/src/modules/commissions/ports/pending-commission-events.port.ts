import type { Tx } from '@pospay/db';

/**
 * عدّاد أحداث العمولة المعلّقة قبل الاعتماد (ADR-0012 §1 و§3). التنفيذ على pospay_app بوظيفة SQL
 * `public.statement_pending_commission_events`؛ لا يقرأ التطبيق جدول outbox مباشرة، ولا يمرّر شركة ولا نوعًا ولا فترة.
 */
export interface PendingCommissionEventsPort {
  /**
   * يلتقط توقيت بداية معاملة الاعتماد نصًّا بلا فقد دقة، ويجب استدعاؤه قبل انتظار قفل الكشف
   * لأن كل حدث أُنشئ قبل هذه اللحظة يعدّ معلّقًا ما لم يحمل علامة استهلاكه.
   *
   * @param tx معاملة الاعتماد التي تبدأ بها العملية
   * @returns `transaction_timestamp()` نصًّا كما تعيده PostgreSQL، لتمريره إلى العدّاد دون تحويل في JavaScript
   */
  captureApprovalStart(tx: Tx): Promise<string>;

  /**
   * يعدّ أحداث العمولة الستة المحسوبة المعلّقة للشركة كلها قبل لحظة البداية، ولا علامة استهلاك لها عند `commissions.project-inputs`.
   * أكبر من صفر يعني رفض الاعتماد بـ 409 `COMMISSION_UPDATES_PENDING` وتراجع المعاملة كلها.
   * **قاعدة التمرير:** مرّر توقيت معاملة الاعتماد نصًّا بلا فقد دقة وحوّله داخل SQL (`$1::text::timestamptz`)،
   * فمعامل من نوع timestamptz يمرّ في سائق postgres.js عبر `Date` الذي يقصّ الميكروثواني إلى ميلي ثانية،
   * والدالة ترفض أي قيمة لا تساوي توقيت معاملتها فتفشل بـ `APPROVAL_CUTOFF_INVALID`. الحدث الموقوف (parked) يبقى معلّقًا.
   *
   * @param tx معاملة الاعتماد نفسها، بسياق الشركة (`withTenant`)، لأن الدالة تأخذ الشركة من السياق وحده
   * @param approvalStartedAt القيمة التي أعادها `captureApprovalStart` على هذه المعاملة نفسها
   * @returns عدد الأحداث المعلّقة، صفر للسماح بتجميد الكشف
   */
  pendingCount(tx: Tx, approvalStartedAt: string): Promise<bigint>;
}
