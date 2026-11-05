/** قاعدة العمولة ملك لهذا السياق؛ المال داخلياً بالفلس فقط. */
export type SessionRule = { kind: 'FOLLOW_PLAN' } | { kind: 'ZERO' } | { kind: 'PCT'; value: number } | { kind: 'FIXED'; value: bigint };
/** سلطة الإضافة أو التسجيل جاءت من settings دون نسخ قواعد حل الحد. */
export type SessionLimit = { source: 'OWNER'; bps: null } | { source: 'PERSON' | 'BUSINESS' | 'NOT_CONFIGURED'; bps: number };
/** حقائق الكتالوج المثبتة تحت قفل الخدمة. */
export interface SessionService { id: string; name_en: string; name_ar: string | null; price: bigint; rule: SessionRule; counts: boolean; revision: number }
/** حقائق الموظفة الآمنة؛ الموظفين وحدهم يحددون يوم الحضور وأهلية الفرع. */
export interface SessionEmployee { id: string; name_en: string; name_ar: string | null; user_id: string | null; eligible: boolean; clocked_in: boolean; approved_leave: boolean }
/** مدخل قواعد البند المدفوع بعد تحويل المال دون فقد؛ ترتيبه في الطلب ثابت. */
export interface SessionDraft {
  input_index: number;
  service_id: string; price: bigint; discount: { kind: 'AMOUNT'; amount: bigint } | { kind: 'PERCENT'; bps: number };
  performers: readonly { employee_id: string; share_bps?: number | undefined }[];
  /** معرّف الموافقة التي أرسلها العميل مع السطر، كما أرسلها. */
  approval_proposal_id?: string | undefined;
}
/** مسودة سطر من الباقة: الاستحقاق باسمه مع خدمته، بلا سعر ولا خصم (FR-020، FR-021). */
export interface PackageSessionDraft {
  input_index: number;
  service_id: string; entitlement_id: string;
  performers: readonly { employee_id: string; share_bps?: number | undefined }[];
}
/** استرداد ثابت لسطر باقة: صف الاسترداد ومكونه وجلسته وترتيبها (FR-025، FR-027). */
export interface SessionLineRedemption {
  /** هوية صف package_redemptions الذي يربط السطر بالجلسة. */
  id: string;
  entitlement_id: string;
  component_id: string;
  /** هوية صف الجلسة في package_session_slots. */
  slot_id: string;
  /** ترتيب الجلسة داخل المكوّن؛ هي أقل جلسة FREE وقت التسجيل. */
  ordinal: number;
}
/** حقائق البند المتحقق منه قبل تقسيم المرفوض من المقبول. */
export interface PreparedSessionLine {
  input_index: number; service: SessionService;
  /** سعر قائمة السطر نفسه؛ سطر الباقة قيمته قيمة جلسته لا سعر الكتالوج (FR-025). */
  list_price: bigint;
  price: bigint; discount: bigint; net: bigint; effective_discount_bps: number;
  performers: { employee: SessionEmployee; share_bps: number; not_clocked_in_warning: boolean; approved_leave_warning: boolean }[];
  has_performer_warning: boolean; explicit_unequal_shares: boolean;
  /** معرّف الموافقة التي طلبها العميل لهذا السطر، إن طلبها. */
  approval_proposal_id?: string | undefined;
  /** معرّف الموافقة التي استهلكها السطر فعلاً، فتُكتب عند القبول فوق الحد فقط. */
  consumed_proposal_id?: string | undefined;
  /** الاسترداد الثابت لسطر الباقة؛ غيابه يعني سطراً مدفوعاً. */
  redemption?: SessionLineRedemption | undefined;
}
/** هوية البند ووقت كاتبته ثابتان، والإضافة لا تعيد كتابة بند محفوظ. */
export interface SessionLine extends PreparedSessionLine {
  id: string; session_id: string; ordinal: number; status: 'ACTIVE' | 'CANCELLED'; revision: number; limit: SessionLimit;
  recorded_by: string; recorded_by_membership_id: string; recorded_at: Date; late: boolean; performer_ids: readonly string[];
  /** الموافقة التي استهلكها السطر كما حُفظت، وغيابها يعني أنه حُفظ على حدّ المسجّلة نفسه. */
  discount_proposal_id?: string | undefined;
}
/** زيارة محفوظة تحت نطاق الشركة؛ الهاتف لا يوجد فيها إلا مقنّعاً. */
export interface SessionRecord {
  id: string; business_id: string; branch_id: string; customer: { id: string; name: string; phone_masked: string };
  recorded_by: string; recorded_by_membership_id: string; occurred_at: Date; recorded_at: Date;
  business_date: string; business_timezone: string; late: boolean; lines: SessionLine[];
}
