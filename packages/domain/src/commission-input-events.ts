/**
 * هوية المستهلك الدائمة لمدخلات العمولة (ADR-0012 §1). علامة الاستهلاك التي تحمل هذه الهوية وحدها
 * تُسقط الحدث من عدّاد الأحداث المعلّقة؛ تغييرها يحتاج انتقال dedupe صريحاً لا مجرد إعادة تسمية.
 */
export const COMMISSION_INPUTS_CONSUMER_ID = 'commissions.project-inputs';

/**
 * أنواع الأحداث الستة التي يسجّلها مستهلك مدخلات العمولة ويعدّها عدّاد الاعتماد (ADR-0012 §1، تعديل 2026-10-22).
 * الترتيب ثابت ليطابق ترتيب القائمة داخل دالة SQL وفهرس إعادة التشغيل، واختبار الدالة المثبّتة يقارنها بنفسها.
 */
export const COMMISSION_INPUT_EVENT_TYPES = [
  'ServiceSessionRecorded',
  'ServiceSessionLinesAdded',
  'ServiceLineChanged',
  'SessionTipsChanged',
  'SalaryChanged',
  'PackageSaleChanged',
] as const;

/**
 * رقم نسخة قواعد إثبات تغطية البيانات القديمة (ADR-0054، إضافة 2026-11-22 البند 5). يطابق ما ترجعه
 * `commission_coverage_required_version()` في قاعدة البيانات؛ أي إصدار يغيّر الأنواع المعدودة أو معرّف المستهلك أو
 * قواعد الإثبات يرفع الرقم هنا وفي دالة الهجرة معًا، واختبار التكافؤ يفشل لو اختلفا.
 */
export const COMMISSION_COVERAGE_PROOF_VERSION = 1;

/**
 * هوية المستهلك الدائمة لتنبيه الحدث الموقوف (ADR-0012 §3). علامتها هي اللي بتمنع تكرار التنبيه
 * على نفس الحدث الموقوف؛ تغييرها معناه تنبيه جديد على كل الأحداث الموقوفة القديمة.
 */
export const PARKED_ALERT_CONSUMER_ID = 'commissions.park-alert';

/**
 * نتائج رفع تنبيه الحدث الموقوف: ليه رُفع التنبيه أو ليه ما رُفعش (ADR-0012 §3).
 * القيم دي بتتقاسمها حالة الاستخدام في موديول العمولات والمسح الدوري في العامل، فلازم تكون في
 * النواة المشتركة: قائمة واحدة في TypeScript مش اتنين، والاختلاف بينها بيقف البناء.
 */
export type ParkedAlertOutcome =
  | 'ALERTED'
  | 'NOT_A_COMMISSION_EVENT'
  | 'NOT_BLOCKING'
  | 'ALREADY_ALERTED'
  | 'NO_OWNERS';
